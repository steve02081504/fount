/** 群角色可配置的权限常量列表。 */
export const ALL_PERMISSIONS = [
	'VIEW_CHANNEL', 'SEND_MESSAGES', 'SEND_STICKERS', 'ADD_REACTIONS',
	'MANAGE_MESSAGES', 'UPLOAD_FILES', 'PIN_MESSAGES', 'CREATE_THREADS',
	'MANAGE_CHANNELS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MANAGE_ROLES',
	'MANAGE_ADMINS', 'INVITE_MEMBERS', 'STREAM', 'MANAGE_FILES', 'ADMIN', 'BYPASS_RATE_LIMIT',
]

/** 频道覆写不可写入超管位（authorizeEvent 硬拒）。 */
export const CHANNEL_OVERRIDE_PERMISSIONS = ALL_PERMISSIONS.filter(
	perm => perm !== 'ADMIN' && perm !== 'MANAGE_ADMINS',
)

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
 * 频道覆写可配置位：排除超管位，且不得超过授予者（ADMIN 旁路）。
 * @param {Record<string, boolean> | null | undefined} grantorPerms 授予者扁平权限
 * @returns {string[]} 可配置权限键
 */
export function grantableChannelOverridePermissions(grantorPerms) {
	const perms = grantorPerms || {}
	if (perms.ADMIN) return [...CHANNEL_OVERRIDE_PERMISSIONS]
	return CHANNEL_OVERRIDE_PERMISSIONS.filter(perm => perms[perm] === true)
}
