import bcrypt from 'bcryptjs';
import { getPool, closePool } from './database';
import { logger } from '../utils/logger';
import { UserTier, TIER_PERMISSIONS, TIER_NAMES } from '../utils/permissions';

async function seed() {
  const pool = getPool();

  // Seed user roles
  const roles = [
    { name: TIER_NAMES[UserTier.SUPER_ADMIN], tier_level: UserTier.SUPER_ADMIN, permissions: TIER_PERMISSIONS[UserTier.SUPER_ADMIN].toString() },
    { name: TIER_NAMES[UserTier.ADMIN], tier_level: UserTier.ADMIN, permissions: TIER_PERMISSIONS[UserTier.ADMIN].toString() },
    { name: TIER_NAMES[UserTier.SUB_ADMIN], tier_level: UserTier.SUB_ADMIN, permissions: TIER_PERMISSIONS[UserTier.SUB_ADMIN].toString() },
    { name: TIER_NAMES[UserTier.MASTER], tier_level: UserTier.MASTER, permissions: TIER_PERMISSIONS[UserTier.MASTER].toString() },
    { name: TIER_NAMES[UserTier.BROKER], tier_level: UserTier.BROKER, permissions: TIER_PERMISSIONS[UserTier.BROKER].toString() },
    { name: TIER_NAMES[UserTier.PLAYER], tier_level: UserTier.PLAYER, permissions: TIER_PERMISSIONS[UserTier.PLAYER].toString() },
  ];

  for (const role of roles) {
    await pool.query(
      `INSERT INTO user_roles (name, tier_level, permissions)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET tier_level = $2, permissions = $3`,
      [role.name, role.tier_level, role.permissions]
    );
    logger.info(`Seeded role: ${role.name}`);
  }

  // Create default SuperAdmin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  const superAdminRole = await pool.query(
    'SELECT id FROM user_roles WHERE name = $1',
    ['super_admin']
  );

  if (superAdminRole.rows.length > 0) {
    const result = await pool.query(
      `INSERT INTO users (username, phone, password_hash, role_id, display_name, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, true, true)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      ['superadmin', '+919999999999', passwordHash, superAdminRole.rows[0].id, 'Super Admin']
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;

      // Create chip wallet for SuperAdmin
      await pool.query(
        `INSERT INTO chip_accounts (owner_id, account_type, balance)
         VALUES ($1, 'wallet', 1000000.00)
         ON CONFLICT (owner_id, account_type) DO NOTHING`,
        [userId]
      );

      // Create self-referencing hierarchy path
      await pool.query(
        `INSERT INTO user_hierarchy_paths (ancestor_id, descendant_id, depth)
         VALUES ($1, $1, 0)
         ON CONFLICT DO NOTHING`,
        [userId]
      );

      logger.info('SuperAdmin user created with 1,000,000 chips');
    }
  }

  logger.info('Seed completed');
  await closePool();
}

seed().catch((err) => {
  logger.error('Seed process failed', { error: err });
  process.exit(1);
});
