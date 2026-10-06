/** Permission katalogi va default rol xaritasi (docs/01-API.md §5.3) — yagona manba. */
export const PERMISSIONS = [
  'platform.clubs.approve', 'platform.clubs.suspend', 'platform.users.view', 'platform.users.block',
  'platform.payments.view', 'platform.payouts.manage', 'platform.subscriptions.manage',
  'platform.reviews.moderate', 'platform.tickets.manage', 'platform.analytics.view',
  'platform.settings.manage', 'platform.audit.view', 'platform.announcements.manage',
  'clubs.view', 'clubs.update', 'clubs.documents.manage',
  'branches.view', 'branches.create', 'branches.update', 'branches.delete',
  'rooms.view', 'rooms.create', 'rooms.update', 'rooms.delete',
  'devices.view', 'devices.create', 'devices.update', 'devices.delete', 'devices.status.change',
  'tariffs.view', 'tariffs.create', 'tariffs.update', 'tariffs.delete',
  'promotions.view', 'promotions.manage',
  'bookings.view', 'bookings.create', 'bookings.cancel', 'bookings.checkin', 'bookings.reschedule',
  'rentals.view', 'rentals.manage', 'rentals.process',
  'sessions.view', 'sessions.start', 'sessions.stop', 'sessions.pause', 'sessions.extend', 'sessions.move',
  'customers.view', 'customers.notes.manage', 'customers.block',
  'payments.view', 'payments.create', 'payments.refund',
  'shifts.open', 'shifts.close', 'shifts.view_all',
  'reports.view', 'reports.export',
  'staff.view', 'staff.create', 'staff.update', 'staff.delete', 'roles.manage',
  'reviews.view', 'reviews.reply',
  'notifications.send', 'announcements.manage',
  'settings.view', 'settings.update',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const all = (prefix: string) => PERMISSIONS.filter((p) => p.startsWith(prefix));
const clubPerms = PERMISSIONS.filter((p) => !p.startsWith('platform.'));

const OPERATOR: Permission[] = [
  'devices.view', 'devices.status.change',
  'bookings.view', 'bookings.create', 'bookings.checkin', 'bookings.cancel',
  ...all('sessions.'), 'rentals.view', 'rentals.process',
  'customers.view', 'payments.view', 'payments.create', 'shifts.open', 'shifts.close',
];
const BRANCH_ADMIN: Permission[] = [
  ...OPERATOR, ...all('rooms.'), ...all('devices.'), ...all('tariffs.'), 'rentals.manage',
  'reports.view', 'staff.view', 'promotions.view', 'branches.view', 'clubs.view',
];
const CLUB_ADMIN: Permission[] = [
  ...BRANCH_ADMIN, 'branches.update', 'staff.create', 'staff.update', 'staff.delete', 'reports.export',
];

export const SYSTEM_ROLES: { code: string; name: string; scope_type: 'PLATFORM' | 'CLUB' | 'BRANCH'; permissions: readonly Permission[] }[] = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', scope_type: 'PLATFORM', permissions: PERMISSIONS },
  {
    code: 'SUPPORT', name: 'Support', scope_type: 'PLATFORM',
    permissions: ['platform.users.view', 'platform.reviews.moderate', 'platform.tickets.manage'],
  },
  { code: 'CLUB_OWNER', name: 'Club Owner', scope_type: 'CLUB', permissions: clubPerms },
  { code: 'CLUB_ADMIN', name: 'Club Admin', scope_type: 'CLUB', permissions: [...new Set(CLUB_ADMIN)] },
  { code: 'BRANCH_ADMIN', name: 'Branch Admin', scope_type: 'BRANCH', permissions: [...new Set(BRANCH_ADMIN)] },
  { code: 'OPERATOR', name: 'Operator', scope_type: 'BRANCH', permissions: [...new Set(OPERATOR)] },
  { code: 'CUSTOMER', name: 'Customer', scope_type: 'PLATFORM', permissions: [] },
];
