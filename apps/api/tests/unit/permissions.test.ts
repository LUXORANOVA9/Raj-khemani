import {
  PERMISSIONS,
  UserTier,
  TIER_PERMISSIONS,
  hasPermission,
  getPermissionsForTier,
  ALLOWED_CHILD_TIERS,
} from '../../src/utils/permissions';

describe('Permissions', () => {
  describe('hasPermission', () => {
    it('should return true when permission is present', () => {
      const perms = PERMISSIONS.PLAY_GAME | PERMISSIONS.VIEW_OWN_STATS;
      expect(hasPermission(perms, PERMISSIONS.PLAY_GAME)).toBe(true);
    });

    it('should return false when permission is absent', () => {
      const perms = PERMISSIONS.PLAY_GAME;
      expect(hasPermission(perms, PERMISSIONS.MANAGE_ADMINS)).toBe(false);
    });

    it('SuperAdmin has all permissions', () => {
      const superAdminPerms = TIER_PERMISSIONS[UserTier.SUPER_ADMIN];
      expect(hasPermission(superAdminPerms, PERMISSIONS.PLAY_GAME)).toBe(true);
      expect(hasPermission(superAdminPerms, PERMISSIONS.MANAGE_ADMINS)).toBe(true);
      expect(hasPermission(superAdminPerms, PERMISSIONS.CHIP_MINT)).toBe(true);
      expect(hasPermission(superAdminPerms, PERMISSIONS.CREATE_PLAYER)).toBe(true);
    });

    it('Player cannot manage admins', () => {
      const playerPerms = TIER_PERMISSIONS[UserTier.PLAYER];
      expect(hasPermission(playerPerms, PERMISSIONS.PLAY_GAME)).toBe(true);
      expect(hasPermission(playerPerms, PERMISSIONS.MANAGE_ADMINS)).toBe(false);
      expect(hasPermission(playerPerms, PERMISSIONS.CREATE_PLAYER)).toBe(false);
    });

    it('Broker can create players but not masters', () => {
      const brokerPerms = TIER_PERMISSIONS[UserTier.BROKER];
      expect(hasPermission(brokerPerms, PERMISSIONS.CREATE_PLAYER)).toBe(true);
      expect(hasPermission(brokerPerms, PERMISSIONS.CREATE_BROKER)).toBe(false);
    });

    it('Master inherits broker permissions', () => {
      const masterPerms = TIER_PERMISSIONS[UserTier.MASTER];
      expect(hasPermission(masterPerms, PERMISSIONS.CREATE_PLAYER)).toBe(true);
      expect(hasPermission(masterPerms, PERMISSIONS.CREATE_BROKER)).toBe(true);
      expect(hasPermission(masterPerms, PERMISSIONS.CREATE_MASTER)).toBe(false);
    });
  });

  describe('getPermissionsForTier', () => {
    it('should return correct permissions for each tier', () => {
      expect(getPermissionsForTier(UserTier.PLAYER)).toBe(TIER_PERMISSIONS[UserTier.PLAYER]);
      expect(getPermissionsForTier(UserTier.SUPER_ADMIN)).toBe(TIER_PERMISSIONS[UserTier.SUPER_ADMIN]);
    });
  });

  describe('ALLOWED_CHILD_TIERS', () => {
    it('SuperAdmin can create Admin', () => {
      expect(ALLOWED_CHILD_TIERS[UserTier.SUPER_ADMIN]).toBe(UserTier.ADMIN);
    });

    it('Admin can create SubAdmin', () => {
      expect(ALLOWED_CHILD_TIERS[UserTier.ADMIN]).toBe(UserTier.SUB_ADMIN);
    });

    it('Player cannot create anyone', () => {
      expect(ALLOWED_CHILD_TIERS[UserTier.PLAYER]).toBeNull();
    });

    it('Each tier creates exactly one level below', () => {
      expect(ALLOWED_CHILD_TIERS[UserTier.SUB_ADMIN]).toBe(UserTier.MASTER);
      expect(ALLOWED_CHILD_TIERS[UserTier.MASTER]).toBe(UserTier.BROKER);
      expect(ALLOWED_CHILD_TIERS[UserTier.BROKER]).toBe(UserTier.PLAYER);
    });
  });
});
