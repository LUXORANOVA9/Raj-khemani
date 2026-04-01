import bcrypt from 'bcryptjs';
import { query, queryOne, withTransaction } from '../../config/database';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../utils/errors';
import { UserTier, ALLOWED_CHILD_TIERS } from '../../utils/permissions';
import { logger } from '../../utils/logger';

export interface UserProfile {
  id: string;
  username: string;
  phone: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  tier_level: number;
  role_name: string;
  parent_id: string | null;
  commission_rate: string;
  wallet_balance: string;
  created_at: string;
  last_login_at: string | null;
}

export async function getUserById(userId: string): Promise<UserProfile> {
  const user = await queryOne<UserProfile>(
    `SELECT u.id, u.username, u.phone, u.email, u.display_name, u.avatar_url,
            u.is_active, u.is_verified, u.parent_id, u.commission_rate,
            u.created_at, u.last_login_at,
            r.tier_level, r.name as role_name,
            COALESCE(ca.balance, 0) as wallet_balance
     FROM users u
     JOIN user_roles r ON u.role_id = r.id
     LEFT JOIN chip_accounts ca ON ca.owner_id = u.id AND ca.account_type = 'wallet'
     WHERE u.id = $1`,
    [userId]
  );

  if (!user) {
    throw new NotFoundError('User');
  }

  return user;
}

export async function getDescendants(
  userId: string,
  depth?: number,
  tierFilter?: number
): Promise<UserProfile[]> {
  let sql = `
    SELECT u.id, u.username, u.phone, u.email, u.display_name, u.avatar_url,
           u.is_active, u.is_verified, u.parent_id, u.commission_rate,
           u.created_at, u.last_login_at,
           r.tier_level, r.name as role_name,
           COALESCE(ca.balance, 0) as wallet_balance,
           hp.depth
    FROM user_hierarchy_paths hp
    JOIN users u ON hp.descendant_id = u.id
    JOIN user_roles r ON u.role_id = r.id
    LEFT JOIN chip_accounts ca ON ca.owner_id = u.id AND ca.account_type = 'wallet'
    WHERE hp.ancestor_id = $1 AND hp.depth > 0
  `;
  const params: unknown[] = [userId];

  if (depth !== undefined) {
    params.push(depth);
    sql += ` AND hp.depth <= $${params.length}`;
  }

  if (tierFilter !== undefined) {
    params.push(tierFilter);
    sql += ` AND r.tier_level = $${params.length}`;
  }

  sql += ' ORDER BY hp.depth, u.username';

  return query<UserProfile>(sql, params);
}

export async function getDirectChildren(userId: string): Promise<UserProfile[]> {
  return getDescendants(userId, 1);
}

export async function createChildUser(
  parentId: string,
  parentTier: number,
  data: {
    username: string;
    password: string;
    phone?: string;
    email?: string;
    displayName?: string;
    commissionRate?: number;
  }
): Promise<UserProfile> {
  const childTier = ALLOWED_CHILD_TIERS[parentTier as UserTier];
  if (childTier === null || childTier === undefined) {
    throw new ForbiddenError('Cannot create child users at this tier level');
  }

  // Check username uniqueness
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE username = $1', [data.username]);
  if (existing) {
    throw new ConflictError('Username already exists');
  }

  const role = await queryOne<{ id: string }>('SELECT id FROM user_roles WHERE tier_level = $1', [childTier]);
  if (!role) {
    throw new NotFoundError('Role');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const userId = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO users (username, phone, email, password_hash, role_id, parent_id, display_name, commission_rate, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)
       RETURNING id`,
      [
        data.username,
        data.phone || null,
        data.email || null,
        passwordHash,
        role.id,
        parentId,
        data.displayName || data.username,
        data.commissionRate || 0,
      ]
    );
    const newUserId = result.rows[0].id as string;

    // Create wallet
    await client.query(
      `INSERT INTO chip_accounts (owner_id, account_type, balance) VALUES ($1, 'wallet', 0.00)`,
      [newUserId]
    );

    // Build hierarchy paths: self-reference + all ancestors
    await client.query(
      `INSERT INTO user_hierarchy_paths (ancestor_id, descendant_id, depth) VALUES ($1, $1, 0)`,
      [newUserId]
    );
    await client.query(
      `INSERT INTO user_hierarchy_paths (ancestor_id, descendant_id, depth)
       SELECT ancestor_id, $1, depth + 1
       FROM user_hierarchy_paths
       WHERE descendant_id = $2`,
      [newUserId, parentId]
    );

    logger.info('Child user created', { parentId, childId: newUserId, tier: childTier });

    return newUserId;
  });

  // Fetch full profile after transaction has committed
  return getUserById(userId);
}

export async function updateUser(
  userId: string,
  data: {
    displayName?: string;
    phone?: string;
    email?: string;
    avatarUrl?: string;
    isActive?: boolean;
    commissionRate?: number;
  }
): Promise<UserProfile> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.displayName !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`);
    params.push(data.displayName);
  }
  if (data.phone !== undefined) {
    setClauses.push(`phone = $${paramIndex++}`);
    params.push(data.phone);
  }
  if (data.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    params.push(data.email);
  }
  if (data.avatarUrl !== undefined) {
    setClauses.push(`avatar_url = $${paramIndex++}`);
    params.push(data.avatarUrl);
  }
  if (data.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(data.isActive);
  }
  if (data.commissionRate !== undefined) {
    setClauses.push(`commission_rate = $${paramIndex++}`);
    params.push(data.commissionRate);
  }

  if (setClauses.length === 0) {
    throw new ValidationError('No fields to update');
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(userId);

  await query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    params
  );

  return getUserById(userId);
}

export async function isAncestorOf(ancestorId: string, descendantId: string): Promise<boolean> {
  const result = await queryOne<{ depth: number }>(
    `SELECT depth FROM user_hierarchy_paths WHERE ancestor_id = $1 AND descendant_id = $2`,
    [ancestorId, descendantId]
  );
  return result !== null && result.depth > 0;
}

export async function getHierarchyStats(userId: string): Promise<{
  totalDescendants: number;
  byTier: Record<string, number>;
  activeCount: number;
}> {
  const stats = await query<{ tier_level: number; role_name: string; count: string; active_count: string }>(
    `SELECT r.tier_level, r.name as role_name, COUNT(*) as count,
            COUNT(*) FILTER (WHERE u.is_active = true) as active_count
     FROM user_hierarchy_paths hp
     JOIN users u ON hp.descendant_id = u.id
     JOIN user_roles r ON u.role_id = r.id
     WHERE hp.ancestor_id = $1 AND hp.depth > 0
     GROUP BY r.tier_level, r.name
     ORDER BY r.tier_level`,
    [userId]
  );

  const byTier: Record<string, number> = {};
  let totalDescendants = 0;
  let activeCount = 0;

  for (const row of stats) {
    byTier[row.role_name] = parseInt(row.count, 10);
    totalDescendants += parseInt(row.count, 10);
    activeCount += parseInt(row.active_count, 10);
  }

  return { totalDescendants, byTier, activeCount };
}
