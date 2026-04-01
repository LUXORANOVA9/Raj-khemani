# Teen Patti Sindhi Taash â€” Technical Architecture Review & Enhancement Report

**Date:** March 31, 2026  
**Prepared by:** Devin (Technical Architecture Review)  
**Scope:** Full-stack, cross-platform Teen Patti card gaming platform with 6-tier hierarchy, virtual chip economy, and real-time multiplayer capabilities

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Validation](#2-architecture-validation)
3. [Technical Deep-Dive](#3-technical-deep-dive)
4. [Implementation Roadmap Critique](#4-implementation-roadmap-critique)
5. [Specific Focus Areas](#5-specific-focus-areas)
6. [Risk Assessment & Mitigation](#6-risk-assessment--mitigation)
7. [Prioritized Recommendations](#7-prioritized-recommendations)
8. [Appendix: Reference Schema Designs](#appendix-reference-schema-designs)

---

## 1. Executive Summary

### Key Findings

The proposed Teen Patti Sindhi Taash platform has a **sound foundational architecture** but faces several critical challenges that must be addressed before production:

1. **CRITICAL â€” Regulatory Compliance:** India passed the *Promotion and Regulation of Online Gaming Act, 2025*, which **bans all real-money gaming nationwide**. The platform's virtual chip model must be carefully designed to ensure it operates as a social/entertainment gaming platform (no cash payouts, no chip-to-money conversion). This is the single biggest risk to the project and must be addressed with legal counsel before development begins.

2. **Architecture Strengths:** The Node.js + Socket.IO + PostgreSQL stack is well-suited for real-time card gaming. The room-based Socket.IO architecture naturally maps to table management. PostgreSQL's ACID compliance is excellent for chip ledger integrity.

3. **Architecture Concerns:** The 6-tier hierarchy adds significant complexity for a 3-5 person team. Socket.IO horizontal scaling requires careful planning with Redis adapter. The 16-week timeline is aggressive and should be extended to 22-24 weeks with buffer.

4. **Biggest Technical Risks:** Chip ledger consistency under concurrent transactions, Socket.IO scalability past 500 concurrent tables on a single node, game engine fairness/auditability, and cross-platform animation performance on low-end Android devices.

### Overall Verdict

**Proceed with modifications.** The architecture is viable but needs the adjustments detailed below to be production-ready. The regulatory environment demands the platform be positioned strictly as a social/entertainment gaming product with no real-money conversion pathway.

---

## 2. Architecture Validation

### 2.1 Six-Tier Hierarchy Model Assessment

**Proposed Hierarchy:**
```
SuperAdmin â†’ Admin â†’ SubAdmin â†’ Master â†’ Broker â†’ Player
```

#### Strengths
- Mirrors traditional Indian gaming distribution networks (agent-based chip distribution)
- Enables multi-level commission tracking and chip flow control
- SuperAdmin has full visibility into all downstream operations

#### Concerns & Recommendations

| Concern | Impact | Recommendation |
|---------|--------|----------------|
| 6 tiers is excessive for MVP | High dev complexity, slow iteration | **Reduce to 4 tiers for MVP:** SuperAdmin â†’ Admin â†’ Agent â†’ Player. Add SubAdmin/Broker tiers in Phase 2 |
| Complex permission matrix (6! possible permission sets) | Auth bugs, security holes | Use bitfield-based permissions with hierarchical inheritance (see Section 3.3) |
| Circular dependency risk in chip flow | Ledger inconsistencies | Enforce strict downward-only chip flow with DAG validation |
| Tier naming confusion (Master vs Admin vs SubAdmin) | UX/DX friction | Use clear, distinct role names that reflect function |

#### Recommended Database Model for Hierarchy

```sql
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE, -- 'super_admin', 'admin', 'sub_admin', 'master', 'broker', 'player'
    tier_level SMALLINT NOT NULL,     -- 0=SuperAdmin, 1=Admin, ..., 5=Player
    permissions BIGINT NOT NULL DEFAULT 0,  -- Bitfield permissions
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES user_roles(id),
    parent_id UUID REFERENCES users(id),  -- Hierarchical parent
    username VARCHAR(100) NOT NULL UNIQUE,
    -- ... other fields
    CONSTRAINT no_self_parent CHECK (id != parent_id)
);

-- Materialized path for efficient hierarchy queries
CREATE TABLE user_hierarchy_paths (
    ancestor_id UUID NOT NULL REFERENCES users(id),
    descendant_id UUID NOT NULL REFERENCES users(id),
    depth INT NOT NULL,
    PRIMARY KEY (ancestor_id, descendant_id)
);

-- Index for fast "get all descendants" queries
CREATE INDEX idx_hierarchy_ancestor ON user_hierarchy_paths(ancestor_id, depth);
CREATE INDEX idx_hierarchy_descendant ON user_hierarchy_paths(descendant_id);
```

**Why closure table over adjacency list?** With 6 tiers, you'll frequently need queries like "get all players under a specific Master" or "calculate total chips distributed by an Admin's entire tree." Adjacency lists require recursive CTEs for this (O(n) queries), while closure tables give you O(1) lookups.

**Trade-off:** Closure tables require maintenance on INSERT/DELETE (trigger-based), but reads are dramatically faster â€” critical for real-time dashboards.

---

### 2.2 Technology Stack Assessment

| Component | Proposed | Verdict | Notes |
|-----------|----------|---------|-------|
| **Backend Runtime** | Node.js | âœ“ Excellent | Event-driven model perfect for I/O-heavy real-time gaming. Single-threaded simplicity. Use Node.js 20+ LTS. |
| **Real-Time** | Socket.IO | âœ“ Good with caveats | Room-based architecture maps well to tables. **Must use Redis adapter** for horizontal scaling. Consider raw WebSockets for game state updates (lower overhead). |
| **Database** | PostgreSQL | âœ“ Excellent | ACID compliance critical for chip ledger. JSONB for flexible game state. Row-level security for multi-tenant queries. |
| **Mobile** | React Native / Expo | âœ“ Good | Code sharing with web. EAS Build simplifies deployment. **Watch for:** animation performance on low-end Android, Expo limitations with native modules. |
| **Web Admin** | React (assumed) | âœ“ Good | Share component library with mobile. Use React Query for real-time dashboard data. |
| **Cache** | Redis (assumed) | âœ“ Essential | Session store, Socket.IO adapter, game state cache, rate limiting, leaderboard sorted sets. |
| **ORM** | Prisma / Knex (TBD) | Depends | **Prisma:** Better DX, type safety, migrations. **Knex:** More control for complex ledger queries. Recommend **Prisma for CRUD + raw SQL for ledger operations**. |

#### Missing Components â€” Must Add

| Component | Recommendation | Why |
|-----------|---------------|-----|
| **Message Queue** | BullMQ (Redis-backed) | Async processing: commission calculations, notifications, audit log writes, report generation |
| **API Gateway / Rate Limiting** | Express middleware + Redis | Prevent abuse, DDoS protection, per-tier rate limits |
| **Monitoring** | Prometheus + Grafana (or Datadog) | Real-time server metrics, game latency, connection counts, chip flow anomalies |
| **Logging** | Winston + structured JSON logs | Audit trail, debugging, compliance |
| **CDN** | CloudFront or Cloudflare | Static assets, card images, sounds |
| **APM** | Sentry | Error tracking across backend + mobile |

---

### 2.3 Database Schema Design â€” Chip Ledger

This is the **highest-stakes** part of the architecture. Chip ledger integrity directly impacts platform trustworthiness and regulatory compliance.

#### Recommended: Double-Entry Ledger Pattern

Every chip movement creates **two entries**: a debit from one account and a credit to another. This ensures the total chip supply is always balanced and every transaction is auditable.

```sql
-- Every user and system entity has a chip account
CREATE TABLE chip_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    account_type VARCHAR(30) NOT NULL, -- 'wallet', 'table_escrow', 'commission', 'system_reserve'
    balance NUMERIC(20, 2) NOT NULL DEFAULT 0.00,
    version INT NOT NULL DEFAULT 0,   -- Optimistic locking
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT positive_balance CHECK (balance >= 0)
);

-- Immutable, append-only ledger
CREATE TABLE chip_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    transfer_id UUID NOT NULL,        -- Groups debit+credit pair
    account_id UUID NOT NULL REFERENCES chip_accounts(id),
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    previous_balance NUMERIC(20, 2) NOT NULL,
    current_balance NUMERIC(20, 2) NOT NULL,
    account_version INT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',      -- Context: game_id, table_id, commission_rate, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure entries are truly append-only
    CONSTRAINT valid_balance_transition CHECK (
        (entry_type = 'credit' AND current_balance = previous_balance + amount) OR
        (entry_type = 'debit' AND current_balance = previous_balance - amount)
    )
);

-- Transfer records (each transfer = 1 debit + 1 credit)
CREATE TABLE chip_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id UUID NOT NULL REFERENCES chip_accounts(id),
    to_account_id UUID NOT NULL REFERENCES chip_accounts(id),
    amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    transfer_type VARCHAR(30) NOT NULL, -- 'distribute', 'collect', 'buy_in', 'cash_out', 'commission', 'game_win', 'game_loss'
    initiated_by UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT no_self_transfer CHECK (from_account_id != to_account_id)
);

-- Indexes for common query patterns
CREATE INDEX idx_ledger_account ON chip_ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_ledger_transfer ON chip_ledger_entries(transfer_id);
CREATE INDEX idx_transfers_from ON chip_transfers(from_account_id, created_at DESC);
CREATE INDEX idx_transfers_to ON chip_transfers(to_account_id, created_at DESC);
CREATE INDEX idx_transfers_type ON chip_transfers(transfer_type, created_at DESC);
```

#### Critical Implementation Rules

1. **All chip operations MUST run inside a PostgreSQL transaction** with `SERIALIZABLE` isolation level (or at minimum `REPEATABLE READ` + optimistic locking via the `version` column).

2. **Use `SELECT ... FOR UPDATE` on accounts** when modifying balances to prevent race conditions:
   ```sql
   BEGIN;
   SELECT balance, version FROM chip_accounts WHERE id = $1 FOR UPDATE;
   -- Validate sufficient balance
   -- Update balance and version atomically
   UPDATE chip_accounts SET balance = balance - $amount, version = version + 1 WHERE id = $1 AND version = $expected_version;
   -- Insert ledger entries
   COMMIT;
   ```

3. **Never delete ledger entries.** The ledger is append-only. Corrections are made via compensating entries (reverse transactions).

4. **Daily reconciliation job:** Sum all ledger entries per account and compare against stored balances. Any discrepancy triggers an alert.

5. **Commission calculation** should be done via database function to ensure atomicity:
   ```sql
   CREATE OR REPLACE FUNCTION process_game_settlement(
       p_game_id UUID,
       p_winner_id UUID,
       p_pot_amount NUMERIC,
       p_commission_rate NUMERIC
   ) RETURNS void AS $$
   DECLARE
       v_commission NUMERIC;
       v_winnings NUMERIC;
   BEGIN
       v_commission := p_pot_amount * p_commission_rate;
       v_winnings := p_pot_amount - v_commission;
       
       -- Transfer winnings to winner
       PERFORM create_chip_transfer(
           'table_escrow_account_id', 
           get_user_wallet(p_winner_id), 
           v_winnings, 
           'game_win'
       );
       
       -- Transfer commission up the hierarchy
       PERFORM distribute_commission(p_game_id, v_commission);
   END;
   $$ LANGUAGE plpgsql;
   ```

---

## 3. Technical Deep-Dive

### 3.1 Socket.IO Real-Time Architecture for 1000+ Concurrent Tables

#### Capacity Estimation

| Metric | Value | Rationale |
|--------|-------|-----------|
| Players per table | 2-9 (avg 5) | Teen Patti standard |
| Concurrent tables target | 1,000 | Stated requirement |
| Concurrent connections | ~5,000 | 1000 tables Ã— 5 avg players |
| Spectators (est.) | ~2,000 | 40% spectator ratio |
| Total connections | ~7,000 | Players + spectators |
| Events per table per second | ~2-5 | Turn-based, not twitch |
| Total events/second | ~5,000 | 1000 tables Ã— 5 avg events |

#### Architecture Design

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   Load Balancer  â”‚
                    â”‚  (Sticky Sessionsâ”‚
                    â”‚   via cookie)    â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚              â”‚              â”‚
        â”Œâ”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”
        â”‚  Node.js   â”‚ â”‚  Node.js   â”‚ â”‚  Node.js   â”‚
        â”‚  Worker 1  â”‚ â”‚  Worker 2  â”‚ â”‚  Worker 3  â”‚
        â”‚ Socket.IO  â”‚ â”‚ Socket.IO  â”‚ â”‚ Socket.IO  â”‚
        â””â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜
              â”‚              â”‚              â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   Redis Cluster  â”‚
                    â”‚  (Socket.IO      â”‚
                    â”‚   Adapter +      â”‚
                    â”‚   Game State     â”‚
                    â”‚   Cache)         â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   PostgreSQL     â”‚
                    â”‚  (Primary +      â”‚
                    â”‚   Read Replica)  â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Key Architecture Decisions

**1. Socket.IO with Redis Adapter (Required for Horizontal Scaling)**

```javascript
// server.js
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

const io = new Server(httpServer, {
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: process.env.ALLOWED_ORIGINS?.split(",") },
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ["websocket"], // Skip polling for gaming
});
```

**2. Room-Based Architecture (One Room per Table)**

```javascript
// Room naming convention
const ROOM_PREFIX = {
    TABLE: "table:",        // table:uuid - game table room
    LOBBY: "lobby:",        // lobby:variant - game variant lobby
    TOURNAMENT: "tourney:", // tourney:uuid - tournament room
    ADMIN: "admin:",        // admin:uuid - admin monitoring feed
};

// Join table
socket.on("join_table", async (tableId) => {
    const table = await tableService.getTable(tableId);
    if (!table) return socket.emit("error", { code: "TABLE_NOT_FOUND" });
    
    // Validate seat availability, user balance, etc.
    const seat = await tableService.seatPlayer(tableId, socket.userId);
    
    socket.join(`table:${tableId}`);
    
    // Send current game state to joining player (private)
    socket.emit("table_state", await gameEngine.getPlayerView(tableId, socket.userId));
    
    // Notify other players (public)
    socket.to(`table:${tableId}`).emit("player_joined", {
        userId: socket.userId,
        seat: seat,
        chipCount: await chipService.getBalance(socket.userId),
    });
});
```

**3. Event Throttling & Validation**

```javascript
// Middleware: rate limit per socket
const rateLimiter = new Map();

io.use((socket, next) => {
    const userId = socket.handshake.auth.userId;
    const now = Date.now();
    const userLimits = rateLimiter.get(userId) || { count: 0, resetAt: now + 1000 };
    
    if (now > userLimits.resetAt) {
        userLimits.count = 0;
        userLimits.resetAt = now + 1000;
    }
    
    userLimits.count++;
    if (userLimits.count > 30) { // Max 30 events/sec per user
        return next(new Error("RATE_LIMIT_EXCEEDED"));
    }
    
    rateLimiter.set(userId, userLimits);
    next();
});
```

#### Scalability Benchmarks & Recommendations

| Scale | Infrastructure | Est. Cost/mo |
|-------|---------------|-------------|
| 0-2,000 connections | 1Ã— 4-core 8GB node + Redis | $50-80 |
| 2,000-10,000 connections | 3Ã— 4-core nodes + Redis Cluster | $200-350 |
| 10,000-50,000 connections | 6Ã— 8-core nodes + Redis Cluster + PG Read Replicas | $800-1,500 |

**Critical: Use `websocket` transport only** (skip HTTP long-polling). Card games don't need the fallback, and polling adds significant overhead. This alone improves capacity by ~40%.

**Critical: Implement connection draining.** When scaling down or deploying, gracefully migrate players to new nodes by completing their current hand before disconnecting.

---

### 3.2 Game Engine Design

#### Architecture: Server-Authoritative State Machine

The game engine must be **fully server-authoritative** â€” clients send intents (fold, call, raise), and the server validates and applies them. Never trust client state.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                 Game State Machine               â”‚
â”‚                                                  â”‚
â”‚  WAITING_FOR_PLAYERS                             â”‚
â”‚       â”‚                                          â”‚
â”‚       â–¼                                          â”‚
â”‚  DEALING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  BOOT_ROUND (ante/blind posting)           â”‚     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  BETTING_ROUND_1 (seen/blind betting)      â”‚     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  BETTING_ROUND_N (continue until 2 remain) â”‚     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  SIDESHOW (optional, between seen players) â”‚     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  SHOWDOWN                                  â”‚     â”‚
â”‚       â”‚                                    â”‚     â”‚
â”‚       â–¼                                    â”‚     â”‚
â”‚  SETTLEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â”‚
â”‚       â”‚                                          â”‚
â”‚       â–¼                                          â”‚
â”‚  WAITING_FOR_PLAYERS (loop)                      â”‚
â”‚                                                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Teen Patti-Specific Game Logic

```javascript
// Core game engine structure
class TeenPattiEngine {
    constructor(config) {
        this.variant = config.variant; // 'classic', 'joker', 'muflis', 'AK47', etc.
        this.minBet = config.minBet;
        this.maxBet = config.maxBet;
        this.maxBlindRounds = config.maxBlindRounds || 4;
    }
    
    // Hand ranking (3-card poker hands, high to low):
    // 1. Trail/Set (three of a kind) - e.g., A-A-A
    // 2. Pure Sequence (straight flush) - e.g., A-2-3 of same suit
    // 3. Sequence (straight) - e.g., 4-5-6
    // 4. Color/Flush - three cards of same suit
    // 5. Pair - two cards of same rank
    // 6. High Card
    
    evaluateHand(cards) {
        // Returns: { rank: number, tiebreakers: number[], description: string }
        // CRITICAL: This must be deterministic and thoroughly unit-tested
        // Test with ALL 22,100 possible 3-card combinations (52C3)
    }
    
    compareHands(hand1, hand2) {
        // Returns: 1 (hand1 wins), -1 (hand2 wins), 0 (tie)
        // Must handle ALL variant-specific rules:
        //   - Muflis: rankings inverted
        //   - AK47: A, K, 4, 7 are jokers
        //   - Joker: random card is wild
    }
    
    validateAction(gameState, playerId, action) {
        // Validates: is it this player's turn? Can they see/call/raise/fold?
        // Blind players can only bet 1x, seen players bet 2x
        // Sideshow: only between two consecutive seen players
    }
}
```

#### Fairness & Auditability

| Requirement | Implementation |
|-------------|---------------|
| **Card shuffling** | Use **Fisher-Yates shuffle** with `crypto.randomBytes()` as the entropy source. Never use `Math.random()`. |
| **Deck integrity** | After shuffle, validate: exactly 52 cards, no duplicates, then hash the deck. Store hash in DB before dealing. |
| **Deal verification** | Store the full shuffled deck (encrypted) at deal time. If disputed, decrypt and verify against the hash. |
| **Action log** | Every player action is logged with timestamp, game state hash, and action details. Immutable audit trail. |
| **RNG certification** | For compliance, consider using a certified RNG library or documenting your shuffle algorithm for independent audit. |

```javascript
// Provably fair shuffling
const crypto = require('crypto');

function shuffleDeck() {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    
    // Fisher-Yates with cryptographic randomness
    for (let i = deck.length - 1; i > 0; i--) {
        const randomBytes = crypto.randomBytes(4);
        const randomIndex = randomBytes.readUInt32BE(0) % (i + 1);
        [deck[i], deck[randomIndex]] = [deck[randomIndex], deck[i]];
    }
    
    // Create verifiable hash
    const deckHash = crypto.createHash('sha256')
        .update(JSON.stringify(deck))
        .digest('hex');
    
    return { deck, deckHash };
}
```

#### Variant Rule Flexibility â€” Strategy Pattern

```javascript
// variants/classic.js
class ClassicTeenPatti extends BaseVariant {
    getHandRanking(cards) { /* standard rankings */ }
    isJoker(card) { return false; }
    getMinPlayers() { return 2; }
    getMaxPlayers() { return 9; }
}

// variants/muflis.js  
class MuflisTeenPatti extends BaseVariant {
    getHandRanking(cards) { /* inverted rankings */ }
}

// variants/ak47.js
class AK47TeenPatti extends BaseVariant {
    isJoker(card) {
        return ['A', 'K', '4', '7'].includes(card.rank);
    }
    getHandRanking(cards) { /* handle joker substitution */ }
}

// Factory
const variants = { classic: ClassicTeenPatti, muflis: MuflisTeenPatti, ak47: AK47TeenPatti };
function createVariant(type) { return new variants[type](); }
```

---

### 3.3 Authentication & Security

#### Multi-Layer Security Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                   Client Layer                    â”‚
â”‚  - Certificate pinning (mobile)                  â”‚
â”‚  - Token storage in secure keychain              â”‚
â”‚  - Anti-tampering (code obfuscation)             â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                 Transport Layer                   â”‚
â”‚  - TLS 1.3 (all connections)                     â”‚
â”‚  - WSS for Socket.IO (never plain WS)            â”‚
â”‚  - CORS whitelist                                â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚               Authentication Layer               â”‚
â”‚  - JWT access tokens (15-min expiry)             â”‚
â”‚  - Refresh tokens (7-day, rotated on use)        â”‚
â”‚  - Device fingerprinting                         â”‚
â”‚  - OTP via SMS for login (Indian market)         â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚               Authorization Layer                â”‚
â”‚  - Hierarchical RBAC with bitfield permissions   â”‚
â”‚  - Row-level security in PostgreSQL              â”‚
â”‚  - Per-action validation middleware              â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                Anti-Fraud Layer                   â”‚
â”‚  - Multi-account detection (device ID, IP)       â”‚
â”‚  - Collusion detection (same-table patterns)     â”‚
â”‚  - Chip laundering detection (unusual flows)     â”‚
â”‚  - Automated anomaly alerts                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Socket.IO Authentication

```javascript
// Socket authentication middleware
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("AUTH_REQUIRED"));
        
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userService.findById(payload.userId);
        
        if (!user || !user.isActive) return next(new Error("USER_INACTIVE"));
        
        // Attach user context to socket
        socket.userId = user.id;
        socket.userRole = user.role;
        socket.userTier = user.tierLevel;
        
        // Track active connections per user (prevent multi-device gaming)
        const existingSocket = await redis.get(`user_socket:${user.id}`);
        if (existingSocket && existingSocket !== socket.id) {
            // Disconnect previous session
            io.to(existingSocket).emit("session_replaced");
            const prevSocket = io.sockets.sockets.get(existingSocket);
            if (prevSocket) prevSocket.disconnect(true);
        }
        
        await redis.set(`user_socket:${user.id}`, socket.id, "EX", 86400);
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return next(new Error("TOKEN_EXPIRED"));
        }
        next(new Error("AUTH_FAILED"));
    }
});
```

#### Bitfield Permissions for Hierarchical RBAC

```javascript
// Permission flags (bitfield)
const PERMISSIONS = {
    // Player permissions (tier 5)
    PLAY_GAME:          1n << 0n,
    VIEW_OWN_STATS:     1n << 1n,
    TRANSFER_CHIPS_DOWN: 0n, // Players can't transfer
    
    // Broker permissions (tier 4) â€” inherits player
    CREATE_PLAYER:      1n << 10n,
    VIEW_PLAYER_STATS:  1n << 11n,
    DISTRIBUTE_CHIPS:   1n << 12n,
    
    // Master permissions (tier 3) â€” inherits broker
    CREATE_BROKER:      1n << 20n,
    VIEW_BROKER_TREE:   1n << 21n,
    SET_COMMISSION_RATE:1n << 22n,
    
    // SubAdmin permissions (tier 2)
    CREATE_MASTER:      1n << 30n,
    VIEW_REPORTS:       1n << 31n,
    MANAGE_TABLES:      1n << 32n,
    
    // Admin permissions (tier 1)
    CREATE_SUB_ADMIN:   1n << 40n,
    MANAGE_GAMES:       1n << 41n,
    VIEW_ALL_REPORTS:   1n << 42n,
    
    // SuperAdmin permissions (tier 0)
    FULL_ACCESS:        (1n << 63n) - 1n, // All bits set
    MANAGE_ADMINS:      1n << 50n,
    SYSTEM_CONFIG:      1n << 51n,
    AUDIT_LOGS:         1n << 52n,
    CHIP_MINT:          1n << 53n, // Only SuperAdmin can create chips
};

// Role definitions with inherited permissions
const ROLE_PERMISSIONS = {
    player: PERMISSIONS.PLAY_GAME | PERMISSIONS.VIEW_OWN_STATS,
    broker: PERMISSIONS.PLAY_GAME | PERMISSIONS.VIEW_OWN_STATS | 
            PERMISSIONS.CREATE_PLAYER | PERMISSIONS.VIEW_PLAYER_STATS | PERMISSIONS.DISTRIBUTE_CHIPS,
    // ... each tier inherits from below and adds its own
};

// Middleware
function requirePermission(permission) {
    return (req, res, next) => {
        const userPerms = BigInt(req.user.permissions);
        if ((userPerms & permission) !== permission) {
            return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" });
        }
        next();
    };
}
```

---

## 4. Implementation Roadmap Critique

### 4.1 Proposed 16-Week Timeline Assessment

The proposed 16-week build is **too aggressive** for a 3-5 person team building a real-time multiplayer gaming platform. Based on industry benchmarks for similar complexity:

#### Revised 24-Week Roadmap

| Phase | Weeks | Focus | Deliverables | Team Allocation |
|-------|-------|-------|-------------|-----------------|
| **0: Foundation** | 1-2 | Project setup, CI/CD, coding standards | Monorepo setup, DB migrations, auth boilerplate, dev environment | Full team |
| **1: Core Backend** | 3-6 | User hierarchy, chip ledger, REST APIs | User CRUD for all 6 tiers, chip transfer system, double-entry ledger, API tests | 3 backend |
| **2: Game Engine** | 5-9 | Teen Patti engine + Socket.IO | Classic variant engine, 22,100-hand test suite, Socket.IO room management, basic game flow | 2 backend |
| **3: Mobile MVP** | 7-12 | React Native app (player-facing) | Auth flow, lobby, table view, game play UI, chip display, basic animations | 2 frontend |
| **4: Admin Panel** | 10-14 | Web admin dashboard | SuperAdmin + Admin dashboards, user management, chip distribution UI, real-time monitoring | 1-2 frontend |
| **5: Advanced Features** | 13-18 | Tournaments, variants, social | Tournament system, 3+ game variants, chat, friends list, player profiles | Full team |
| **6: Polish & Testing** | 17-21 | Performance, security, UX | Load testing (1000 tables), security audit, UX polish, card animations, sound effects | Full team |
| **7: Soft Launch** | 22-24 | Beta deployment, monitoring | Production deployment, monitoring dashboards, bug triage, feedback collection | Full team |

**Note:** Phases overlap intentionally â€” e.g., frontend work begins while backend game engine is still in progress.

### 4.2 Critical Path & Bottlenecks

```
CRITICAL PATH (longest dependency chain):
Auth System â†’ User Hierarchy â†’ Chip Ledger â†’ Game Engine â†’ Socket.IO Integration â†’ Mobile Game UI â†’ Testing â†’ Launch
                                                                                    â†‘
                                                                            This is the bottleneck.
                                                                      Mobile game UI depends on ALL
                                                                      backend systems being stable.
```

**Top 5 Bottleneck Risks:**

1. **Game engine correctness** (Weeks 5-9): Hand evaluation bugs are extremely visible to players and destroy trust. Allocate 30% of engine development time to testing alone. The 22,100 possible 3-card hands must all be evaluated correctly.

2. **Socket.IO â†” Game Engine integration** (Weeks 7-10): This is where real-time game state synchronization happens. Race conditions between player actions, timeouts, and disconnections are the #1 source of bugs in multiplayer card games.

3. **Chip ledger under concurrent load** (Weeks 5-8): Double-entry accounting with optimistic locking needs extensive concurrency testing. Use `pgbench` or custom load tests to simulate 100+ simultaneous chip transfers.

4. **Mobile animation performance** (Weeks 10-15): Card dealing, flipping, and chip animations on low-end Android devices (2GB RAM, budget SoCs). Use React Native Reanimated v3 + Skia for GPU-accelerated rendering. Test on real devices early.

5. **Cross-platform consistency** (Weeks 12-18): Ensuring game state is identical across iOS, Android, and web. Use a shared state management layer (Zustand or Redux) with a single source of truth.

### 4.3 Technical Debt Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Skipping unit tests on game engine to save time | High | Critical | Mandate 90%+ coverage on hand evaluation before any other work proceeds |
| Hardcoding classic variant, making other variants painful to add | High | High | Build variant system with Strategy pattern from Day 1 |
| Monolithic Socket.IO event handlers | Medium | High | Separate event handlers by domain (game, chat, lobby, admin) from the start |
| No database migrations strategy | Medium | Medium | Use Prisma Migrate or `node-pg-migrate` from Week 1 |
| Missing error boundaries in React Native | Medium | Medium | Implement Sentry + error boundaries before first beta |
| No feature flags | Low | Medium | Use a simple JSON config + admin toggle for feature rollout |

---

## 5. Specific Focus Areas

### 5.1 SuperAdmin Control Panel

The SuperAdmin panel is the **nerve center** of the platform. It must provide both operational control and real-time visibility.

#### Required Dashboard Modules

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                     SUPERADMIN DASHBOARD                        â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  LIVE METRICS    â”‚  HIERARCHY VIEW  â”‚  ALERTS & ANOMALIES       â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€   â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€      â”‚
â”‚  Active tables   â”‚  Tree view of    â”‚  Unusual chip flows       â”‚
â”‚  Online players  â”‚  all 6 tiers     â”‚  High-value transfers     â”‚
â”‚  Total chips in  â”‚  Expand/collapse â”‚  Multi-account suspects   â”‚
â”‚  circulation     â”‚  Search by user  â”‚  System health alerts     â”‚
â”‚  Revenue (comm.) â”‚  Quick actions   â”‚  Failed transactions      â”‚
â”‚  Avg table size  â”‚  Chip flow viz   â”‚  Connection spike alerts  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                     CHIP ECONOMY OVERVIEW                       â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                  â”‚
â”‚  Total minted â”‚ In circulation â”‚ In escrow â”‚ Commission pool    â”‚
â”‚  Flow sankey diagram: SuperAdmin â†’ Admin â†’ ... â†’ Player        â”‚
â”‚  Daily mint/burn report                                         â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                     GAME OPERATIONS                             â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                          â”‚
â”‚  Active games list (sortable, filterable)                       â”‚
â”‚  Game variant distribution pie chart                            â”‚
â”‚  Observe any table in real-time (spectator mode)                â”‚
â”‚  Force-close table capability                                   â”‚
â”‚  Player ban/suspend controls                                    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                     REPORTS & ANALYTICS                         â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                          â”‚
â”‚  Daily/Weekly/Monthly revenue reports                           â”‚
â”‚  Per-tier commission breakdown                                  â”‚
â”‚  Player retention and engagement metrics                        â”‚
â”‚  Exportable CSV/PDF reports                                     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Real-Time Monitoring Implementation

```javascript
// SuperAdmin real-time feed via dedicated Socket.IO namespace
const adminNamespace = io.of("/admin");

adminNamespace.use(requireRole("super_admin")); // Auth middleware

adminNamespace.on("connection", (socket) => {
    // Join admin monitoring room
    socket.join("admin:live_feed");
    
    // Send initial dashboard state
    socket.emit("dashboard_state", {
        activeTables: tableManager.getActiveCount(),
        onlinePlayers: connectionManager.getOnlineCount(),
        totalChipsInCirculation: await chipService.getTotalCirculation(),
        recentAlerts: await alertService.getRecent(20),
    });
});

// Broadcast updates to admin dashboard (throttled to 1/sec)
setInterval(async () => {
    adminNamespace.to("admin:live_feed").emit("metrics_update", {
        activeTables: tableManager.getActiveCount(),
        onlinePlayers: connectionManager.getOnlineCount(),
        eventsPerSecond: metricsCollector.getEPS(),
        avgLatency: metricsCollector.getAvgLatency(),
    });
}, 1000);

// High-priority alerts (immediate)
chipService.on("large_transfer", (transfer) => {
    if (transfer.amount > ALERT_THRESHOLD) {
        adminNamespace.to("admin:live_feed").emit("alert", {
            type: "LARGE_TRANSFER",
            severity: "warning",
            data: transfer,
            timestamp: new Date(),
        });
    }
});
```

---

### 5.2 Chip Economy Flow & Commission Calculation

#### Chip Flow Architecture

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚  SuperAdmin   â”‚
                    â”‚  (Chip Mint)  â”‚ â† ONLY entity that can create chips
                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                           â”‚ distribute
                    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚    Admin      â”‚ â† Takes X% commission on pass-through
                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                           â”‚ distribute
                    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   SubAdmin    â”‚ â† Takes Y% commission
                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                           â”‚ distribute
                    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚    Master     â”‚ â† Takes Z% commission
                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                           â”‚ distribute
                    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚    Broker     â”‚ â† Takes W% commission
                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                           â”‚ distribute
                    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚    Player     â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚  Game Table   â”‚
                    â”‚   (Wallet)    â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚  (Escrow)     â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ winnings  â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                                      â”‚ rake/commission
                                              â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”
                                              â”‚  Commission   â”‚
                                              â”‚  Distribution â”‚
                                              â”‚  (up the tree)â”‚
                                              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Commission Calculation â€” Accuracy Requirements

**Problem:** Floating-point arithmetic causes rounding errors that accumulate over thousands of games. A 0.01% error across 10,000 games can create phantom chips or missing chips.

**Solution:**

1. **Use `NUMERIC(20, 2)` in PostgreSQL** â€” not `FLOAT` or `DOUBLE PRECISION`. `NUMERIC` is exact decimal arithmetic.

2. **Use integer arithmetic in Node.js** â€” store chip amounts as integers (paisa/cents). `1000` = â‚¹10.00. This avoids JavaScript floating-point issues entirely.

3. **Commission distribution algorithm:**

```javascript
// Commission flows UP the hierarchy
async function distributeCommission(gameId, totalCommission) {
    const game = await getGame(gameId);
    const table = await getTable(game.tableId);
    const commissionRates = await getHierarchyCommissionRates(table.createdBy);
    
    // commissionRates example:
    // [{ userId: brokerId, rate: 0.20 },    // Broker gets 20% of commission
    //  { userId: masterId, rate: 0.25 },     // Master gets 25%
    //  { userId: subAdminId, rate: 0.25 },   // SubAdmin gets 25%
    //  { userId: adminId, rate: 0.20 },      // Admin gets 20%
    //  { userId: superAdminId, rate: 0.10 }] // SuperAdmin gets 10%
    
    // IMPORTANT: Rates MUST sum to 1.0 (100%)
    // Use "largest remainder method" for rounding to avoid chip leakage
    
    let distributed = 0;
    const distributions = commissionRates.map((tier, index) => {
        const isLast = index === commissionRates.length - 1;
        const amount = isLast
            ? totalCommission - distributed  // Last tier gets remainder (prevents rounding loss)
            : Math.floor(totalCommission * tier.rate);
        distributed += amount;
        return { userId: tier.userId, amount };
    });
    
    // Execute all transfers in single transaction
    await db.transaction(async (trx) => {
        for (const dist of distributions) {
            await chipService.transfer(
                game.escrowAccountId,
                await chipService.getWalletId(dist.userId),
                dist.amount,
                'commission',
                { gameId, rate: dist.rate },
                trx
            );
        }
    });
}
```

4. **Daily reconciliation query:**

```sql
-- Verify: total minted = total in all accounts
SELECT 
    (SELECT SUM(balance) FROM chip_accounts) AS total_in_accounts,
    (SELECT SUM(amount) FROM chip_transfers WHERE transfer_type = 'mint') AS total_minted,
    (SELECT SUM(amount) FROM chip_transfers WHERE transfer_type = 'burn') AS total_burned,
    (SELECT SUM(balance) FROM chip_accounts) - 
    ((SELECT SUM(amount) FROM chip_transfers WHERE transfer_type = 'mint') - 
     (SELECT SUM(amount) FROM chip_transfers WHERE transfer_type = 'burn')) AS discrepancy;
-- discrepancy MUST always be 0
```

---

### 5.3 Cross-Platform Mobile Development Strategy

#### Expo vs Bare React Native Decision

**Recommendation: Start with Expo (managed workflow), eject if needed.**

| Factor | Expo Managed | Bare RN | Verdict |
|--------|-------------|---------|---------|
| Setup speed | Instant | Hours of native config | Expo wins |
| OTA updates | Built-in (EAS Update) | Manual (CodePush) | Expo wins |
| Build/deploy | EAS Build (cloud) | Local Xcode/Android Studio | Expo wins |
| Native modules | Limited (improving with SDK 53+) | Full access | Bare wins |
| Card animations | Reanimated + Skia via Expo | Same | Tie |
| Socket.IO | Full support | Full support | Tie |
| Push notifications | expo-notifications | react-native-firebase | Tie |
| App size | Larger (~25MB+) | Smaller (~15MB+) | Bare wins |

**For a 3-5 person team, Expo saves 2-3 weeks of setup/configuration time.** The new architecture in Expo SDK 53+ supports most native modules. Only eject if you need a specific native capability not supported by Expo.

#### Mobile Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚              React Native App            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Navigation (Expo Router v5)             â”‚
â”‚    â”œâ”€â”€ Auth Stack (Login, OTP, Register) â”‚
â”‚    â”œâ”€â”€ Main Tab Navigator                â”‚
â”‚    â”‚     â”œâ”€â”€ Lobby Screen                â”‚
â”‚    â”‚     â”œâ”€â”€ My Tables Screen            â”‚
â”‚    â”‚     â”œâ”€â”€ Profile/Wallet Screen       â”‚
â”‚    â”‚     â””â”€â”€ Settings Screen             â”‚
â”‚    â””â”€â”€ Game Stack (Modal)                â”‚
â”‚          â””â”€â”€ Game Table Screen           â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  State Management                        â”‚
â”‚    â”œâ”€â”€ Zustand (global app state)        â”‚
â”‚    â”œâ”€â”€ React Query (API data + cache)    â”‚
â”‚    â””â”€â”€ Socket Context (real-time state)  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Real-Time Layer                         â”‚
â”‚    â”œâ”€â”€ Socket.IO Client                  â”‚
â”‚    â”œâ”€â”€ Connection Manager (reconnect)    â”‚
â”‚    â””â”€â”€ Event Queue (offline buffering)   â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  UI Components                           â”‚
â”‚    â”œâ”€â”€ Card Component (Skia-rendered)    â”‚
â”‚    â”œâ”€â”€ Chip Stack Component              â”‚
â”‚    â”œâ”€â”€ Table Layout (oval, 2-9 seats)    â”‚
â”‚    â”œâ”€â”€ Action Buttons (fold/call/raise)  â”‚
â”‚    â””â”€â”€ Chat Overlay                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Animation Engine                        â”‚
â”‚    â”œâ”€â”€ Reanimated v3 (gestures, layout)  â”‚
â”‚    â”œâ”€â”€ Skia (card faces, effects)        â”‚
â”‚    â””â”€â”€ Lottie (celebratory animations)  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Performance Optimization for Indian Market (Low-End Devices)

The Indian gaming audience predominantly uses budget Android devices (Redmi, Realme, Samsung M-series). Design for:

| Constraint | Target | Strategy |
|-----------|--------|----------|
| RAM | 2-3GB devices | Limit in-memory state, lazy-load screens, minimize image assets |
| CPU | Mediatek Helio/Dimensity budget SoCs | Use `useNativeDriver: true` for all animations, offload to UI thread via Reanimated |
| Network | 4G with variable latency (50-500ms) | Optimistic UI updates, reconnection handling, offline queue |
| Screen | 720p-1080p, 60Hz | Design at 360dp width, test at 720p |
| Storage | 32-64GB (shared with other apps) | Keep app under 50MB, cache cards/assets lazily |
| Data usage | Cost-sensitive users | Minimize payload sizes, use binary protocol for game state (MessagePack), compress Socket.IO messages |

```javascript
// Socket.IO client with reconnection strategy for Indian networks
const socket = io(BACKEND_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
    auth: { token: authToken },
    // Use MessagePack parser for smaller payloads
    parser: require("socket.io-msgpack-parser"),
});

// Handle network state changes (mobile)
import NetInfo from "@react-native-community/netinfo";

NetInfo.addEventListener((state) => {
    if (state.isConnected && !socket.connected) {
        socket.connect();
    }
});
```

---

## 6. Risk Assessment & Mitigation

### 6.1 Risk Matrix

| # | Risk | Probability | Impact | Risk Score | Mitigation |
|---|------|------------|--------|------------|------------|
| 1 | **Regulatory action** â€” platform classified as real-money gaming | Medium | Critical | **HIGH** | Legal review before development. No chip-to-money conversion. Clear ToS. No "cash out" language. Consult gaming lawyer. |
| 2 | **Chip ledger corruption** â€” race conditions cause phantom/missing chips | Medium | Critical | **HIGH** | Double-entry ledger, SERIALIZABLE transactions, daily reconciliation, automated alerts on discrepancy. |
| 3 | **Game engine bugs** â€” incorrect hand evaluation or unfair dealing | Medium | High | **HIGH** | Exhaustive test suite (22,100 hands), provably fair shuffling, independent code review of engine. |
| 4 | **Socket.IO scaling failure** â€” server crashes at 500+ tables | Medium | High | **HIGH** | Redis adapter from Day 1, load test early (Week 10), horizontal scaling architecture, connection limits per node. |
| 5 | **Team burnout** â€” 16-week aggressive timeline | High | Medium | **HIGH** | Extend to 24 weeks, prioritize MVP features, defer tournaments to Phase 2. |
| 6 | **Mobile performance** â€” laggy on budget Android devices | High | Medium | **MEDIUM** | Test on real devices from Week 8, performance budget, Reanimated + Skia, profile with Flipper. |
| 7 | **Security breach** â€” chip theft, account takeover | Low | Critical | **MEDIUM** | JWT + refresh tokens, rate limiting, device fingerprinting, IP monitoring, penetration testing before launch. |
| 8 | **Data loss** â€” PostgreSQL failure | Low | Critical | **MEDIUM** | Daily automated backups, point-in-time recovery (WAL archiving), read replica as hot standby. |
| 9 | **App store rejection** â€” gambling classification | Medium | Medium | **MEDIUM** | Frame as "social entertainment," no real-money language, comply with Apple/Google guidelines for simulated gambling. |
| 10 | **Collusion between players** â€” coordinated cheating | Medium | Medium | **MEDIUM** | IP/device tracking at tables, statistical analysis of play patterns, reporting system, manual review queue. |

### 6.2 Regulatory Compliance Deep-Dive

Given the 2025 Online Gaming Act, the platform **must** ensure:

1. **No real-money conversion:** Chips cannot be redeemed, withdrawn, or converted to money/gifts with monetary value. This must be technically impossible (no withdrawal API) and clearly stated in ToS.

2. **No "deposit" language:** Users "receive" or "earn" chips â€” they don't "deposit" or "buy" them. The in-app purchase of chips (if any) must be structured as purchasing virtual entertainment credits, not a stored value.

3. **Age verification:** Implement age gate (18+ for gaming apps in India). KYC may not be legally required for virtual-chip-only platforms, but adds credibility.

4. **State-specific laws:** Some Indian states (Andhra Pradesh, Telangana, Tamil Nadu, Assam, Odisha, Karnataka, Kerala, Nagaland, Sikkim) have additional gaming restrictions. Consider geo-blocking or state-specific ToS.

5. **App Store compliance:**
   - **Google Play:** Allows simulated gambling apps in India with restrictions (no real-money, age-gated, clear disclaimers)
   - **Apple App Store:** Guideline 5.3.4 â€” simulated gambling OK if free or in-app purchase chips, no cash prizes

6. **Data protection:** Comply with India's Digital Personal Data Protection Act (DPDPA) 2023 â€” consent collection, data minimization, breach notification.

**Recommendation:** Engage a gaming/tech lawyer before Week 1 of development. Budget â‚¹1-3 lakhs for legal review of ToS, privacy policy, and platform structure. This is non-negotiable.

---

## 7. Prioritized Recommendations

### Tier 1: Must-Do Before Development Starts

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 1 | **Legal review** of virtual chip model under 2025 Online Gaming Act | 1-2 weeks | Prevents project shutdown |
| 2 | **Reduce hierarchy to 4 tiers for MVP** (SuperAdmin, Admin, Agent, Player) | Architecture decision | Cuts complexity by ~40% |
| 3 | **Implement double-entry chip ledger** with the schema in Section 2.3 | 2 weeks | Ensures chip integrity |
| 4 | **Set up Redis from Day 1** for Socket.IO adapter + session store + cache | 1 day | Enables horizontal scaling later |

### Tier 2: Must-Do During Development

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 5 | **Build exhaustive game engine test suite** before integrating with Socket.IO | 1 week | Prevents critical game bugs |
| 6 | **Use Strategy pattern for game variants** from the start | 2-3 days | Prevents costly refactor later |
| 7 | **Implement optimistic locking on chip accounts** | 1-2 days | Prevents race conditions |
| 8 | **Set up Sentry** for error tracking across backend + mobile | 1 day | Catch production bugs fast |
| 9 | **Test on real budget Android devices** from Week 8 onward | Ongoing | Prevents late-stage performance crises |
| 10 | **Use MessagePack parser** for Socket.IO to reduce bandwidth | 2 hours | 30-40% smaller payloads |

### Tier 3: Should-Do Before Launch

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 11 | **Load test** with simulated 1000 tables (use Artillery or k6) | 3-5 days | Validates scaling architecture |
| 12 | **Security audit** â€” penetration testing, dependency scanning | 1-2 weeks | Prevents breaches |
| 13 | **Implement daily reconciliation job** for chip ledger | 1 day | Detects ledger drift early |
| 14 | **Set up monitoring** (Prometheus + Grafana or equivalent) | 2-3 days | Operational visibility |
| 15 | **Implement feature flags** for controlled rollout | 1 day | Reduces launch risk |

### Tier 4: Nice-to-Have / Phase 2

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| 16 | Tournament system | 3-4 weeks | Player engagement |
| 17 | Full 6-tier hierarchy (add SubAdmin, Broker) | 2-3 weeks | Distribution network |
| 18 | Collusion detection ML model | 4-6 weeks | Anti-fraud |
| 19 | Voice chat at tables (WebRTC) | 2-3 weeks | Social engagement |
| 20 | Replay/hand history viewer | 1-2 weeks | Player retention |

---

## Appendix: Reference Schema Designs

### A. Complete Database Schema Overview

```sql
-- ============================================
-- CORE TABLES
-- ============================================

-- Users & Hierarchy
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(15) UNIQUE,          -- Primary auth for Indian market
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role_id UUID NOT NULL REFERENCES user_roles(id),
    parent_id UUID REFERENCES users(id),
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    device_fingerprint JSONB,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game Tables
CREATE TABLE game_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    variant VARCHAR(30) NOT NULL DEFAULT 'classic',
    min_buy_in NUMERIC(20,2) NOT NULL,
    max_buy_in NUMERIC(20,2) NOT NULL,
    min_bet NUMERIC(20,2) NOT NULL,
    max_bet NUMERIC(20,2) NOT NULL,
    max_players SMALLINT NOT NULL DEFAULT 9,
    is_private BOOLEAN DEFAULT false,
    password_hash VARCHAR(255),        -- For private tables
    status VARCHAR(20) DEFAULT 'waiting', -- waiting, active, paused, closed
    created_by UUID NOT NULL REFERENCES users(id),
    commission_rate NUMERIC(5,4) DEFAULT 0.05, -- 5% default rake
    escrow_account_id UUID REFERENCES chip_accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Game Rounds
CREATE TABLE game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES game_tables(id),
    round_number INT NOT NULL,
    deck_hash VARCHAR(64) NOT NULL,     -- SHA-256 of shuffled deck
    deck_encrypted TEXT NOT NULL,        -- Encrypted full deck (for disputes)
    pot_amount NUMERIC(20,2) DEFAULT 0,
    commission_amount NUMERIC(20,2) DEFAULT 0,
    winner_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'dealing', 
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- Player Actions (immutable audit trail)
CREATE TABLE game_actions (
    id BIGSERIAL PRIMARY KEY,
    round_id UUID NOT NULL REFERENCES game_rounds(id),
    player_id UUID NOT NULL REFERENCES users(id),
    action_type VARCHAR(20) NOT NULL,  -- 'bet_blind', 'bet_seen', 'call', 'raise', 'fold', 'show', 'sideshow'
    amount NUMERIC(20,2),
    game_state_hash VARCHAR(64),       -- Hash of game state at time of action
    sequence_number INT NOT NULL,       -- Order of actions within round
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(round_id, sequence_number)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_users_parent ON users(parent_id);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_tables_status ON game_tables(status);
CREATE INDEX idx_tables_variant ON game_tables(variant);
CREATE INDEX idx_rounds_table ON game_rounds(table_id, round_number DESC);
CREATE INDEX idx_actions_round ON game_actions(round_id, sequence_number);
CREATE INDEX idx_actions_player ON game_actions(player_id, created_at DESC);
```

### B. Recommended Monorepo Structure

```
teen-patti-sindhi-taash/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ api/                    # Node.js backend
â”‚   â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”‚   â”œâ”€â”€ config/         # Environment, database, redis config
â”‚   â”‚   â”‚   â”œâ”€â”€ middleware/     # Auth, rate-limit, error handling
â”‚   â”‚   â”‚   â”œâ”€â”€ modules/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ auth/       # Login, OTP, JWT
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ users/      # User CRUD, hierarchy management
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ chips/      # Chip ledger, transfers, reconciliation
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ tables/     # Table management, matchmaking
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ game/       # Game engine, variants, state machine
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ tournaments/# Tournament management
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ admin/      # Admin-specific endpoints
â”‚   â”‚   â”‚   â”œâ”€â”€ socket/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ handlers/   # Event handlers by domain
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ middleware/ # Socket auth, rate limiting
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ index.ts    # Socket.IO setup
â”‚   â”‚   â”‚   â””â”€â”€ utils/          # Shared utilities
â”‚   â”‚   â”œâ”€â”€ tests/
â”‚   â”‚   â”‚   â”œâ”€â”€ unit/           # Hand evaluation, commission calc
â”‚   â”‚   â”‚   â”œâ”€â”€ integration/    # API tests, DB tests
â”‚   â”‚   â”‚   â””â”€â”€ load/           # k6/Artillery scripts
â”‚   â”‚   â””â”€â”€ package.json
â”‚   â”œâ”€â”€ mobile/                 # React Native / Expo app
â”‚   â”‚   â”œâ”€â”€ app/                # Expo Router screens
â”‚   â”‚   â”œâ”€â”€ components/         # UI components
â”‚   â”‚   â”œâ”€â”€ hooks/              # Custom hooks
â”‚   â”‚   â”œâ”€â”€ services/           # API + Socket clients
â”‚   â”‚   â”œâ”€â”€ stores/             # Zustand stores
â”‚   â”‚   â””â”€â”€ package.json
â”‚   â””â”€â”€ admin-web/              # React admin dashboard
â”‚       â”œâ”€â”€ src/
â”‚       â”‚   â”œâ”€â”€ pages/          # Dashboard pages
â”‚       â”‚   â”œâ”€â”€ components/     # UI components
â”‚       â”‚   â””â”€â”€ services/       # API clients
â”‚       â””â”€â”€ package.json
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ shared-types/           # TypeScript types shared across apps
â”‚   â”œâ”€â”€ game-engine/            # Pure game logic (testable independently)
â”‚   â””â”€â”€ ui-components/          # Shared UI components (if applicable)
â”œâ”€â”€ docker-compose.yml          # Local dev: PostgreSQL + Redis
â”œâ”€â”€ turbo.json                  # Turborepo config
â””â”€â”€ package.json                # Root workspace config
```

### C. Key Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/teen_patti
DATABASE_POOL_SIZE=20

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=<256-bit-random>
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
OTP_SERVICE_API_KEY=<sms-provider-key>

# Socket.IO
SOCKET_CORS_ORIGINS=http://localhost:3000,https://app.teenpatti.example.com
SOCKET_PING_INTERVAL=10000
SOCKET_PING_TIMEOUT=5000

# Game
DEFAULT_COMMISSION_RATE=0.05
MAX_TABLES_PER_NODE=500
MAX_CONNECTIONS_PER_NODE=3000

# Monitoring
SENTRY_DSN=<sentry-dsn>
LOG_LEVEL=info

# Feature Flags
FEATURE_TOURNAMENTS=false
FEATURE_VOICE_CHAT=false
FEATURE_MUFLIS_VARIANT=true
FEATURE_AK47_VARIANT=true
```

---

*End of Technical Architecture Review. For questions or follow-up analysis, please provide the specific architecture document for more targeted recommendations.*