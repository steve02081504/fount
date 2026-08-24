/** 群角色可配置的权限常量列表。 */
export const ALL_PERMISSIONS = [
	'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS',
	'MANAGE_MESSAGES', 'UPLOAD_FILES', 'PIN_MESSAGES', 'CREATE_THREADS',
	'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES',
	'MANAGE_ADMINS', 'INVITE_MEMBERS', 'STREAM', 'MANAGE_FILES', 'ADMIN', 'BYPASS_RATE_LIMIT',
]

/** 群级治理权限：可写入群权限覆写。 */
export const GROUP_PERMISSIONS = [
	'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES', 'MANAGE_ADMINS', 'INVITE_MEMBERS',
]

/** 频道级权限：可写入频道权限覆写。 */
export const CHANNEL_PERMISSIONS = [
	'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS',
	'MANAGE_MESSAGES', 'MANAGE_CHANNELS', 'STREAM', 'CREATE_THREADS',
	'UPLOAD_FILES', 'MANAGE_FILES', 'PIN_MESSAGES', 'MENTION_EVERYONE',
]

/** 超管位：仅可经角色基础权限授予，不进入任何覆写。 */
export const SUPERUSER_PERMISSIONS = ['ADMIN', 'MANAGE_ADMINS', 'BYPASS_RATE_LIMIT']

/**
 * 授予者可配置的角色权限位：超管位需 MANAGE_ADMINS；其余位不得超过授予者已有位（ADMIN 旁路）。
 * @param {Record<string, boolean> | null | undefined} grantorPerms 授予者扁平权限
 * @returns {string[]} 可配置权限键
 */
export function grantableRolePermissions(grantorPerms) {
	const perms = grantorPerms || {}
	if (perms.ADMIN) return [...ALL_PERMISSIONS]
	return ALL_PERMISSIONS.filter(perm => {
		if (perm === 'ADMIN' || perm === 'MANAGE_ADMINS')
			return perms.MANAGE_ADMINS === true
		return perms[perm] === true
	})
}

/**
 * 频道覆写可配置位：仅频道级权限，且不得超过授予者（ADMIN 旁路）。
 * @param {Record<string, boolean> | null | undefined} grantorPerms 授予者扁平权限
 * @returns {string[]} 可配置权限键
 */
export function grantableChannelOverridePermissions(grantorPerms) {
	const perms = grantorPerms || {}
	if (perms.ADMIN) return [...CHANNEL_PERMISSIONS]
	return CHANNEL_PERMISSIONS.filter(perm => perms[perm] === true)
}

/**
 * 群覆写可配置位：仅群级治理权限，且不得超过授予者（ADMIN 旁路）。
 * @param {Record<string, boolean> | null | undefined} grantorPerms 授予者扁平权限
 * @returns {string[]} 可配置权限键
 */
export function grantableGroupOverridePermissions(grantorPerms) {
	const perms = grantorPerms || {}
	if (perms.ADMIN) return [...GROUP_PERMISSIONS]
	return GROUP_PERMISSIONS.filter(perm => perms[perm] === true)
}
