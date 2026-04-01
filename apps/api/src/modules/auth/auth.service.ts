import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../config/env';
import { query, queryOne, withTransaction } from '../../config/database';
import { AuthError, NotFoundError, ConflictError } from '../../utils/errors';
import { UserTier, getPermissionsForTier } from '../../utils/permissions';
import { logger } from '../../utils/logger';

export interface UserRecord {
  id: string;
  username: string;
  phone: string | null;
  email: string | null;
  password_hash: string;
  role_id: string;
  parent_id: string | null;
  display_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  tier_level: number;
  role_name: string;
  permissions: string;
  commission_rate: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  tier: number;
  permissions: string;
}

function generateAccessToken(user: UserRecord): string {
  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    tier: user.tier_level,
    permissions: user.permissions,
  };
  // Cast expiresIn to satisfy jsonwebtoken's expected type
  const options: jwt.SignOptions = { expiresIn: env.JWT_EXPIRY as unknown as number };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

async function generateRefreshToken(userId: string, deviceInfo: Record<string, unknown> = {}): Promise<string> {
  const token = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, JSON.stringify(deviceInfo), expiresAt]
  );

  return token;
}

export async function login(username: string, password: string): Promise<TokenPair> {
  const user = await queryOne<UserRecord>(
    `SELECT u.*, r.tier_level, r.name as role_name, r.permissions
     FROM users u
     JOIN user_roles r ON u.role_id = r.id
     WHERE u.username = $1`,
    [username]
  );

  if (!user) {
    throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  if (!user.is_active) {
    throw new AuthError('Account is deactivated', 'ACCOUNT_INACTIVE');
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  // Update last login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id);

  logger.info('User logged in', { userId: user.id, username: user.username, tier: user.tier_level });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_EXPIRY,
  };
}

export async function refreshAccessToken(refreshTokenValue: string): Promise<TokenPair> {
  const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

  const tokenRecord = await queryOne<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!tokenRecord || tokenRecord.revoked_at) {
    throw new AuthError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    throw new AuthError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  // Revoke old token and issue new pair (token rotation)
  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [tokenRecord.id]);

  const user = await queryOne<UserRecord>(
    `SELECT u.*, r.tier_level, r.name as role_name, r.permissions
     FROM users u
     JOIN user_roles r ON u.role_id = r.id
     WHERE u.id = $1`,
    [tokenRecord.user_id]
  );

  if (!user || !user.is_active) {
    throw new AuthError('User not found or inactive', 'USER_INACTIVE');
  }

  const accessToken = generateAccessToken(user);
  const newRefreshToken = await generateRefreshToken(user.id);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: env.JWT_EXPIRY,
  };
}

export async function register(data: {
  username: string;
  password: string;
  phone?: string;
  email?: string;
  displayName?: string;
  parentId?: string;
  tier: UserTier;
}): Promise<{ userId: string; tokens: TokenPair }> {
  // Check username uniqueness
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE username = $1', [data.username]);
  if (existing) {
    throw new ConflictError('Username already exists');
  }

  // Get role for tier
  const role = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM user_roles WHERE tier_level = $1',
    [data.tier]
  );
  if (!role) {
    throw new NotFoundError('Role for tier');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const userId = await withTransaction(async (client) => {
    // Create user
    const userResult = await client.query(
      `INSERT INTO users (username, phone, email, password_hash, role_id, parent_id, display_name, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)
       RETURNING id`,
      [data.username, data.phone || null, data.email || null, passwordHash, role.id, data.parentId || null, data.displayName || data.username]
    );
    const newUserId = userResult.rows[0].id as string;

    // Create chip wallet
    await client.query(
      `INSERT INTO chip_accounts (owner_id, account_type, balance) VALUES ($1, 'wallet', 0.00)`,
      [newUserId]
    );

    // Build hierarchy paths
    // Self-reference
    await client.query(
      `INSERT INTO user_hierarchy_paths (ancestor_id, descendant_id, depth) VALUES ($1, $1, 0)`,
      [newUserId]
    );

    // Copy parent's ancestor paths and extend
    if (data.parentId) {
      await client.query(
        `INSERT INTO user_hierarchy_paths (ancestor_id, descendant_id, depth)
         SELECT ancestor_id, $1, depth + 1
         FROM user_hierarchy_paths
         WHERE descendant_id = $2`,
        [newUserId, data.parentId]
      );
    }

    logger.info('User registered', { userId: newUserId, username: data.username, tier: data.tier });

    return newUserId;
  });

  // Generate tokens after transaction has committed
  const user: UserRecord = {
    id: userId,
    username: data.username,
    phone: data.phone || null,
    email: data.email || null,
    password_hash: passwordHash,
    role_id: role.id,
    parent_id: data.parentId || null,
    display_name: data.displayName || data.username,
    is_active: true,
    is_verified: false,
    tier_level: data.tier,
    role_name: role.name,
    permissions: getPermissionsForTier(data.tier).toString(),
    commission_rate: '0.00',
  };

  const accessToken = generateAccessToken(user);
  const refreshToken = await generateRefreshToken(userId);

  return {
    userId,
    tokens: { accessToken, refreshToken, expiresIn: env.JWT_EXPIRY },
  };
}

export async function logout(userId: string): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  logger.info('User logged out (all tokens revoked)', { userId });
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError('Token expired', 'TOKEN_EXPIRED');
    }
    throw new AuthError('Invalid token', 'INVALID_TOKEN');
  }
}
