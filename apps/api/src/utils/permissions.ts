// Bitfield-based permission system for hierarchical RBAC
// Each permission is a single bit in a BigInt

export const PERMISSIONS = {
  // Player permissions (tier 5)
  PLAY_GAME:            1n << 0n,
  VIEW_OWN_STATS:       1n << 1n,
  VIEW_OWN_WALLET:      1n << 2n,

  // Broker permissions (tier 4)
  CREATE_PLAYER:        1n << 10n,
  VIEW_PLAYER_STATS:    1n << 11n,
  DISTRIBUTE_CHIPS:     1n << 12n,
  VIEW_DOWNSTREAM:      1n << 13n,

  // Master permissions (tier 3)
  CREATE_BROKER:        1n << 20n,
  VIEW_BROKER_TREE:     1n << 21n,
  SET_COMMISSION_RATE:  1n << 22n,

  // SubAdmin permissions (tier 2)
  CREATE_MASTER:        1n << 30n,
  VIEW_REPORTS:         1n << 31n,
  MANAGE_TABLES:        1n << 32n,

  // Admin permissions (tier 1)
  CREATE_SUB_ADMIN:     1n << 40n,
  MANAGE_GAMES:         1n << 41n,
  VIEW_ALL_REPORTS:     1n << 42n,
  MANAGE_USERS:         1n << 43n,

  // SuperAdmin permissions (tier 0)
  MANAGE_ADMINS:        1n << 50n,
  SYSTEM_CONFIG:        1n << 51n,
  AUDIT_LOGS:           1n << 52n,
  CHIP_MINT:            1n << 53n,
  FULL_ACCESS:          (1n << 60n) - 1n,
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export enum UserTier {
  SUPER_ADMIN = 0,
  ADMIN = 1,
  SUB_ADMIN = 2,
  MASTER = 3,
  BROKER = 4,
  PLAYER = 5,
}

export const TIER_NAMES: Record<UserTier, string> = {
  [UserTier.SUPER_ADMIN]: 'super_admin',
  [UserTier.ADMIN]: 'admin',
  [UserTier.SUB_ADMIN]: 'sub_admin',
  [UserTier.MASTER]: 'master',
  [UserTier.BROKER]: 'broker',
  [UserTier.PLAYER]: 'player',
};

// Each role inherits all permissions from lower tiers
const PLAYER_PERMS = PERMISSIONS.PLAY_GAME | PERMISSIONS.VIEW_OWN_STATS | PERMISSIONS.VIEW_OWN_WALLET;

const BROKER_PERMS = PLAYER_PERMS |
  PERMISSIONS.CREATE_PLAYER | PERMISSIONS.VIEW_PLAYER_STATS |
  PERMISSIONS.DISTRIBUTE_CHIPS | PERMISSIONS.VIEW_DOWNSTREAM;

const MASTER_PERMS = BROKER_PERMS |
  PERMISSIONS.CREATE_BROKER | PERMISSIONS.VIEW_BROKER_TREE | PERMISSIONS.SET_COMMISSION_RATE;

const SUB_ADMIN_PERMS = MASTER_PERMS |
  PERMISSIONS.CREATE_MASTER | PERMISSIONS.VIEW_REPORTS | PERMISSIONS.MANAGE_TABLES;

const ADMIN_PERMS = SUB_ADMIN_PERMS |
  PERMISSIONS.CREATE_SUB_ADMIN | PERMISSIONS.MANAGE_GAMES |
  PERMISSIONS.VIEW_ALL_REPORTS | PERMISSIONS.MANAGE_USERS;

const SUPER_ADMIN_PERMS = PERMISSIONS.FULL_ACCESS;

export const TIER_PERMISSIONS: Record<UserTier, bigint> = {
  [UserTier.SUPER_ADMIN]: SUPER_ADMIN_PERMS,
  [UserTier.ADMIN]: ADMIN_PERMS,
  [UserTier.SUB_ADMIN]: SUB_ADMIN_PERMS,
  [UserTier.MASTER]: MASTER_PERMS,
  [UserTier.BROKER]: BROKER_PERMS,
  [UserTier.PLAYER]: PLAYER_PERMS,
};

export function hasPermission(userPermissions: bigint, requiredPermission: bigint): boolean {
  return (userPermissions & requiredPermission) === requiredPermission;
}

export function getPermissionsForTier(tier: UserTier): bigint {
  return TIER_PERMISSIONS[tier] ?? 0n;
}

// Allowed child tiers: each tier can only create the tier directly below it
export const ALLOWED_CHILD_TIERS: Record<UserTier, UserTier | null> = {
  [UserTier.SUPER_ADMIN]: UserTier.ADMIN,
  [UserTier.ADMIN]: UserTier.SUB_ADMIN,
  [UserTier.SUB_ADMIN]: UserTier.MASTER,
  [UserTier.MASTER]: UserTier.BROKER,
  [UserTier.BROKER]: UserTier.PLAYER,
  [UserTier.PLAYER]: null,
};
