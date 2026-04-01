import { getPool, closePool } from './database';
import { logger } from '../utils/logger';

const MIGRATIONS = [
  {
    name: '001_create_user_roles',
    sql: `
      CREATE TABLE IF NOT EXISTS user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL UNIQUE,
        tier_level SMALLINT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '0',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '002_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) NOT NULL UNIQUE,
        phone VARCHAR(15) UNIQUE,
        email VARCHAR(255),
        password_hash VARCHAR(255) NOT NULL,
        role_id UUID NOT NULL REFERENCES user_roles(id),
        parent_id UUID REFERENCES users(id),
        display_name VARCHAR(100),
        avatar_url VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        is_verified BOOLEAN DEFAULT false,
        last_login_at TIMESTAMPTZ,
        commission_rate NUMERIC(5,4) DEFAULT 0.00,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT no_self_parent CHECK (id != parent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    `,
  },
  {
    name: '003_create_user_hierarchy_paths',
    sql: `
      CREATE TABLE IF NOT EXISTS user_hierarchy_paths (
        ancestor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        descendant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        depth INT NOT NULL,
        PRIMARY KEY (ancestor_id, descendant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_ancestor ON user_hierarchy_paths(ancestor_id, depth);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_descendant ON user_hierarchy_paths(descendant_id);
    `,
  },
  {
    name: '004_create_refresh_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        device_info JSONB DEFAULT '{}',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
    `,
  },
  {
    name: '005_create_chip_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS chip_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID NOT NULL REFERENCES users(id),
        account_type VARCHAR(30) NOT NULL DEFAULT 'wallet',
        balance NUMERIC(20, 2) NOT NULL DEFAULT 0.00,
        version INT NOT NULL DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT positive_balance CHECK (balance >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_chip_accounts_owner ON chip_accounts(owner_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chip_accounts_owner_type ON chip_accounts(owner_id, account_type);
    `,
  },
  {
    name: '006_create_chip_transfers',
    sql: `
      CREATE TABLE IF NOT EXISTS chip_transfers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_account_id UUID NOT NULL REFERENCES chip_accounts(id),
        to_account_id UUID NOT NULL REFERENCES chip_accounts(id),
        amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
        transfer_type VARCHAR(30) NOT NULL,
        initiated_by UUID NOT NULL REFERENCES users(id),
        description TEXT,
        metadata JSONB DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT no_self_transfer CHECK (from_account_id != to_account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transfers_from ON chip_transfers(from_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_to ON chip_transfers(to_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfers_type ON chip_transfers(transfer_type, created_at DESC);
    `,
  },
  {
    name: '007_create_chip_ledger_entries',
    sql: `
      CREATE TABLE IF NOT EXISTS chip_ledger_entries (
        id BIGSERIAL PRIMARY KEY,
        transfer_id UUID NOT NULL REFERENCES chip_transfers(id),
        account_id UUID NOT NULL REFERENCES chip_accounts(id),
        entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
        amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
        previous_balance NUMERIC(20, 2) NOT NULL,
        current_balance NUMERIC(20, 2) NOT NULL,
        account_version INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT valid_balance_transition CHECK (
          (entry_type = 'credit' AND current_balance = previous_balance + amount) OR
          (entry_type = 'debit' AND current_balance = previous_balance - amount)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_account ON chip_ledger_entries(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_transfer ON chip_ledger_entries(transfer_id);
    `,
  },
  {
    name: '008_create_game_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS game_tables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        variant VARCHAR(30) NOT NULL DEFAULT 'classic',
        min_buy_in NUMERIC(20,2) NOT NULL,
        max_buy_in NUMERIC(20,2) NOT NULL,
        min_bet NUMERIC(20,2) NOT NULL,
        max_bet NUMERIC(20,2),
        max_players SMALLINT NOT NULL DEFAULT 9,
        is_private BOOLEAN DEFAULT false,
        password_hash VARCHAR(255),
        status VARCHAR(20) DEFAULT 'waiting',
        created_by UUID NOT NULL REFERENCES users(id),
        commission_rate NUMERIC(5,4) DEFAULT 0.0500,
        escrow_account_id UUID REFERENCES chip_accounts(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_tables_status ON game_tables(status);
      CREATE INDEX IF NOT EXISTS idx_tables_variant ON game_tables(variant);
    `,
  },
  {
    name: '009_create_game_rounds',
    sql: `
      CREATE TABLE IF NOT EXISTS game_rounds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL REFERENCES game_tables(id),
        round_number INT NOT NULL,
        deck_hash VARCHAR(64) NOT NULL,
        deck_encrypted TEXT NOT NULL,
        pot_amount NUMERIC(20,2) DEFAULT 0,
        commission_amount NUMERIC(20,2) DEFAULT 0,
        winner_id UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'dealing',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_rounds_table ON game_rounds(table_id, round_number DESC);
    `,
  },
  {
    name: '010_create_game_actions',
    sql: `
      CREATE TABLE IF NOT EXISTS game_actions (
        id BIGSERIAL PRIMARY KEY,
        round_id UUID NOT NULL REFERENCES game_rounds(id),
        player_id UUID NOT NULL REFERENCES users(id),
        action_type VARCHAR(20) NOT NULL,
        amount NUMERIC(20,2),
        game_state_hash VARCHAR(64),
        sequence_number INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(round_id, sequence_number)
      );

      CREATE INDEX IF NOT EXISTS idx_actions_round ON game_actions(round_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_actions_player ON game_actions(player_id, created_at DESC);
    `,
  },
  {
    name: '011_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
];

async function migrate() {
  const pool = getPool();

  // Create migrations tracking table first
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const migration of MIGRATIONS) {
    if (migration.name === '011_create_migrations_table') continue;

    const existing = await pool.query(
      'SELECT id FROM _migrations WHERE name = $1',
      [migration.name]
    );

    if (existing.rows.length > 0) {
      logger.info(`Migration already applied: ${migration.name}`);
      continue;
    }

    try {
      await pool.query(migration.sql);
      await pool.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [migration.name]
      );
      logger.info(`Migration applied: ${migration.name}`);
    } catch (error) {
      logger.error(`Migration failed: ${migration.name}`, { error });
      throw error;
    }
  }

  logger.info('All migrations completed');
  await closePool();
}

migrate().catch((err) => {
  logger.error('Migration process failed', { error: err });
  process.exit(1);
});
