import { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';
import { InsufficientChipsError, NotFoundError, ForbiddenError, ValidationError } from '../../utils/errors';
import { isAncestorOf } from '../users/users.service';
import { logger } from '../../utils/logger';

export interface ChipAccount {
  id: string;
  owner_id: string;
  account_type: string;
  balance: string;
  version: number;
  is_active: boolean;
}

export interface TransferRecord {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: string;
  transfer_type: string;
  initiated_by: string;
  description: string | null;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  transfer_id: string;
  account_id: string;
  entry_type: string;
  amount: string;
  previous_balance: string;
  current_balance: string;
  account_version: number;
  created_at: string;
}

export async function getWalletBalance(userId: string): Promise<string> {
  const account = await queryOne<ChipAccount>(
    `SELECT * FROM chip_accounts WHERE owner_id = $1 AND account_type = 'wallet'`,
    [userId]
  );
  return account?.balance ?? '0.00';
}

export async function getWalletAccount(userId: string): Promise<ChipAccount> {
  const account = await queryOne<ChipAccount>(
    `SELECT * FROM chip_accounts WHERE owner_id = $1 AND account_type = 'wallet'`,
    [userId]
  );
  if (!account) {
    throw new NotFoundError('Wallet account');
  }
  return account;
}

export async function getAccountById(accountId: string): Promise<ChipAccount> {
  const account = await queryOne<ChipAccount>(
    `SELECT * FROM chip_accounts WHERE id = $1`,
    [accountId]
  );
  if (!account) {
    throw new NotFoundError('Chip account');
  }
  return account;
}

// Core double-entry transfer function
async function executeTransfer(
  client: PoolClient,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  transferType: string,
  initiatedBy: string,
  description?: string,
  metadata?: Record<string, unknown>
): Promise<TransferRecord> {
  if (amount <= 0) {
    throw new ValidationError('Transfer amount must be positive');
  }

  // Lock source account with FOR UPDATE to prevent race conditions
  const fromResult = await client.query(
    `SELECT id, balance, version FROM chip_accounts WHERE id = $1 FOR UPDATE`,
    [fromAccountId]
  );
  if (fromResult.rows.length === 0) {
    throw new NotFoundError('Source account');
  }

  const fromAccount = fromResult.rows[0];
  const fromBalance = parseFloat(fromAccount.balance);

  if (fromBalance < amount) {
    throw new InsufficientChipsError(amount, fromBalance);
  }

  // Lock destination account
  const toResult = await client.query(
    `SELECT id, balance, version FROM chip_accounts WHERE id = $1 FOR UPDATE`,
    [toAccountId]
  );
  if (toResult.rows.length === 0) {
    throw new NotFoundError('Destination account');
  }

  const toAccount = toResult.rows[0];
  const toBalance = parseFloat(toAccount.balance);

  // Calculate new balances
  const newFromBalance = fromBalance - amount;
  const newToBalance = toBalance + amount;
  const newFromVersion = fromAccount.version + 1;
  const newToVersion = toAccount.version + 1;

  // Update balances
  await client.query(
    `UPDATE chip_accounts SET balance = $1, version = $2, updated_at = NOW() WHERE id = $3`,
    [newFromBalance, newFromVersion, fromAccountId]
  );
  await client.query(
    `UPDATE chip_accounts SET balance = $1, version = $2, updated_at = NOW() WHERE id = $3`,
    [newToBalance, newToVersion, toAccountId]
  );

  // Create transfer record
  const transferResult = await client.query(
    `INSERT INTO chip_transfers (from_account_id, to_account_id, amount, transfer_type, initiated_by, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [fromAccountId, toAccountId, amount, transferType, initiatedBy, description || null, JSON.stringify(metadata || {})]
  );
  const transfer = transferResult.rows[0];

  // Create double-entry ledger entries
  // Debit entry (from account)
  await client.query(
    `INSERT INTO chip_ledger_entries (transfer_id, account_id, entry_type, amount, previous_balance, current_balance, account_version)
     VALUES ($1, $2, 'debit', $3, $4, $5, $6)`,
    [transfer.id, fromAccountId, amount, fromBalance, newFromBalance, newFromVersion]
  );

  // Credit entry (to account)
  await client.query(
    `INSERT INTO chip_ledger_entries (transfer_id, account_id, entry_type, amount, previous_balance, current_balance, account_version)
     VALUES ($1, $2, 'credit', $3, $4, $5, $6)`,
    [transfer.id, toAccountId, amount, toBalance, newToBalance, newToVersion]
  );

  logger.info('Chip transfer completed', {
    transferId: transfer.id,
    from: fromAccountId,
    to: toAccountId,
    amount,
    type: transferType,
  });

  return transfer;
}

// Distribute chips from parent to child (downward only)
export async function distributeChips(
  fromUserId: string,
  toUserId: string,
  amount: number,
  initiatedBy: string
): Promise<TransferRecord> {
  // Validate hierarchical relationship: fromUser must be ancestor of toUser
  const isValidHierarchy = await isAncestorOf(fromUserId, toUserId);
  if (!isValidHierarchy) {
    throw new ForbiddenError('Can only distribute chips to downstream users');
  }

  const fromAccount = await getWalletAccount(fromUserId);
  const toAccount = await getWalletAccount(toUserId);

  return withTransaction(async (client) => {
    return executeTransfer(
      client,
      fromAccount.id,
      toAccount.id,
      amount,
      'distribute',
      initiatedBy,
      `Chip distribution from ${fromUserId} to ${toUserId}`
    );
  });
}

// Collect chips from child to parent (upward only)
export async function collectChips(
  fromUserId: string,
  toUserId: string,
  amount: number,
  initiatedBy: string
): Promise<TransferRecord> {
  const isValidHierarchy = await isAncestorOf(toUserId, fromUserId);
  if (!isValidHierarchy) {
    throw new ForbiddenError('Can only collect chips from downstream users');
  }

  const fromAccount = await getWalletAccount(fromUserId);
  const toAccount = await getWalletAccount(toUserId);

  return withTransaction(async (client) => {
    return executeTransfer(
      client,
      fromAccount.id,
      toAccount.id,
      amount,
      'collect',
      initiatedBy,
      `Chip collection from ${fromUserId} to ${toUserId}`
    );
  });
}

// Mint chips (SuperAdmin only)
export async function mintChips(
  superAdminId: string,
  amount: number
): Promise<TransferRecord> {
  return withTransaction(async (client) => {
    // Create or get system reserve account
    let systemAccount = await queryOne<ChipAccount>(
      `SELECT * FROM chip_accounts WHERE owner_id = $1 AND account_type = 'system_reserve'`,
      [superAdminId]
    );

    if (!systemAccount) {
      const result = await client.query(
        `INSERT INTO chip_accounts (owner_id, account_type, balance) VALUES ($1, 'system_reserve', 0)
         ON CONFLICT (owner_id, account_type) DO NOTHING
         RETURNING *`,
        [superAdminId]
      );
      systemAccount = result.rows[0] as ChipAccount | undefined ?? null;
      if (!systemAccount) {
        const selectResult = await client.query(
          `SELECT * FROM chip_accounts WHERE owner_id = $1 AND account_type = 'system_reserve'`,
          [superAdminId]
        );
        systemAccount = selectResult.rows[0] as ChipAccount;
      }
    }

    if (!systemAccount) {
      throw new NotFoundError('System reserve account');
    }

    const wallet = await getWalletAccount(superAdminId);

    // For minting, we credit from system_reserve (which can go negative conceptually)
    // But we'll add balance to system_reserve first, then transfer
    await client.query(
      `UPDATE chip_accounts SET balance = balance + $1, version = version + 1 WHERE id = $2`,
      [amount, systemAccount.id]
    );

    return executeTransfer(
      client,
      systemAccount.id,
      wallet.id,
      amount,
      'mint',
      superAdminId,
      `Minted ${amount} chips`
    );
  });
}

// Get transfer history for a user
export async function getTransferHistory(
  userId: string,
  options: { limit?: number; offset?: number; type?: string } = {}
): Promise<{ transfers: TransferRecord[]; total: number }> {
  const account = await getWalletAccount(userId);
  const limit = options.limit || 50;
  const offset = options.offset || 0;
  const params: unknown[] = [account.id];
  let whereClause = `(from_account_id = $1 OR to_account_id = $1)`;

  if (options.type) {
    params.push(options.type);
    whereClause += ` AND transfer_type = $${params.length}`;
  }

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM chip_transfers WHERE ${whereClause}`,
    params
  );

  params.push(limit, offset);
  const transfers = await query<TransferRecord>(
    `SELECT * FROM chip_transfers WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    transfers,
    total: parseInt(countResult[0]?.count ?? '0', 10),
  };
}

// Get ledger entries for an account
export async function getLedgerEntries(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<LedgerEntry[]> {
  const account = await getWalletAccount(userId);
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  return query<LedgerEntry>(
    `SELECT * FROM chip_ledger_entries WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [account.id, limit, offset]
  );
}

// Daily reconciliation check
export async function runReconciliation(): Promise<{
  isBalanced: boolean;
  totalInAccounts: string;
  discrepancies: Array<{ accountId: string; storedBalance: string; calculatedBalance: string }>;
}> {
  // Check each account's stored balance against ledger entries
  const discrepancies = await query<{
    accountId: string;
    storedBalance: string;
    calculatedBalance: string;
  }>(
    `SELECT
       ca.id as "accountId",
       ca.balance as "storedBalance",
       COALESCE(
         (SELECT SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END)
          FROM chip_ledger_entries WHERE account_id = ca.id),
         0
       ) as "calculatedBalance"
     FROM chip_accounts ca
     WHERE ca.balance != COALESCE(
       (SELECT SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END)
        FROM chip_ledger_entries WHERE account_id = ca.id),
       0
     )`
  );

  const totalResult = await queryOne<{ total: string }>(
    `SELECT SUM(balance) as total FROM chip_accounts`
  );

  return {
    isBalanced: discrepancies.length === 0,
    totalInAccounts: totalResult?.total ?? '0',
    discrepancies,
  };
}
