/**
 * 权限系统（§8）：物化权限 + 频道 allow/deny 的「按特定度分层」求值（Discord 式覆写语义）。
 *
 * 求值优先级（由宽到具体，后者覆盖前者）：
 *   1. 全局基线：成员所有角色的全局权限并集。
 *   2. 频道内 @everyone 覆写（先去 deny 再叠 allow）。
 *   3. 频道内具体角色覆写（合并成员所有角色的 allow/deny 后整体应用：先去 deny 再叠 allow）。
 * 因此更具体层级的 allow 可重新授予更宽层级 deny 掉的能力（例如私密频道 @everyone deny SEND，
 * 但某角色 allow SEND → 该角色可发帖），更具体层级的 deny 亦可覆盖更宽层级的 allow。
 *
 * ADMIN/owner 旁路：持有 ADMIN 的成员拥有全部能力且不受任何频道覆写限制（Discord ADMINISTRATOR 语义），
 * 故私密频道里 owner/admin 始终可发帖。
 *
 * 不可翻案的硬禁言：由成员级 ban（`member_ban` → status≠active）实现，在 `memberChannelPermissions`
 * 进入本函数之前即返回全 false，故对任何角色 / 频道 allow / ADMIN 旁路一律免疫——这是无法被翻案的硬 deny 维度。
 */

/** 内置权限能力 */
export const PERMISSIONS = {
	VIEW_CHANNEL: 'VIEW_CHANNEL',
	SEND_MESSAGES: 'SEND_MESSAGES',
	SEND_STICKERS: 'SEND_STICKERS',
	ADD_REACTIONS: 'ADD_REACTIONS',
	MANAGE_MESSAGES: 'MANAGE_MESSAGES',
	MANAGE_CHANNELS: 'MANAGE_CHANNELS',
	KICK_MEMBERS: 'KICK_MEMBERS',
	BAN_MEMBERS: 'BAN_MEMBERS',
	MANAGE_ROLES: 'MANAGE_ROLES',
	MANAGE_ADMINS: 'MANAGE_ADMINS',
	INVITE_MEMBERS: 'INVITE_MEMBERS',
	STREAM: 'STREAM',
	CREATE_THREADS: 'CREATE_THREADS',
	UPLOAD_FILES: 'UPLOAD_FILES',
	MANAGE_FILES: 'MANAGE_FILES',
	PIN_MESSAGES: 'PIN_MESSAGES',
	ADMIN: 'ADMIN',
	BYPASS_RATE_LIMIT: 'BYPASS_RATE_LIMIT',
}

/** 持久化位图顺序：禁止重排或插入，仅可在末尾追加新权限。 */
export const PERMISSION_ORDER = [
	PERMISSIONS.VIEW_CHANNEL,
	PERMISSIONS.SEND_MESSAGES,
	PERMISSIONS.SEND_STICKERS,
	PERMISSIONS.ADD_REACTIONS,
	PERMISSIONS.MANAGE_MESSAGES,
	PERMISSIONS.MANAGE_CHANNELS,
	PERMISSIONS.KICK_MEMBERS,
	PERMISSIONS.BAN_MEMBERS,
	PERMISSIONS.MANAGE_ROLES,
	PERMISSIONS.MANAGE_ADMINS,
	PERMISSIONS.INVITE_MEMBERS,
	PERMISSIONS.STREAM,
	PERMISSIONS.CREATE_THREADS,
	PERMISSIONS.UPLOAD_FILES,
	PERMISSIONS.MANAGE_FILES,
	PERMISSIONS.PIN_MESSAGES,
	PERMISSIONS.ADMIN,
	PERMISSIONS.BYPASS_RATE_LIMIT,
]

/** ADMIN 在 PERMISSION_ORDER 中的位序（旁路判定用）。 */
const ADMIN_BIT = 1n << BigInt(PERMISSION_ORDER.indexOf(PERMISSIONS.ADMIN))

/**
 * 权限编码为 BigInt（容忍 null/undefined：空覆写记为 0n）。
 * @param {Record<string, boolean> | null | undefined} permissions 权限对象
 * @returns {bigint} 按位编码
 */
export function encodePermissions(permissions) {
	let bits = 0n
	if (!permissions) return bits
	for (let index = 0; index < PERMISSION_ORDER.length; index++)
		if (permissions[PERMISSION_ORDER[index]])
			bits |= 1n << BigInt(index)
	return bits
}

/**
 * BigInt 解码为权限对象
 * @param {bigint} bits 权限位
 * @returns {Record<string, boolean>} 各权限名到布尔值
 */
export function decodePermissions(bits) {
	/** @type {Record<string, boolean>} */
	const permissions = {}
	for (let index = 0; index < PERMISSION_ORDER.length; index++)
		permissions[PERMISSION_ORDER[index]] = Boolean(bits & (1n << BigInt(index)))
	return permissions
}

/**
 * 计算成员在频道内的最终权限（按特定度分层求值，见文件头说明）。
 * @param {object} member 成员对象
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {Record<string, boolean>} 最终权限 Record
 */
export function calculateMemberPermissions(member, roles, channelId, channelPermissions) {
	const roleIds = member.roles || []

	// 1. 全局基线：成员所有角色的全局权限并集。
	let baseBits = 0n
	for (const roleId of roleIds) {
		const role = roles[roleId]
		if (role) baseBits |= encodePermissions(role.permissions)
	}

	// ADMIN/owner 旁路：拥有全部能力并无视任何频道覆写（Discord ADMINISTRATOR）。
	// 硬禁言（ban）在 memberChannelPermissions 中先于本函数拦截，故不会经此旁路。
	if (baseBits & ADMIN_BIT) {
		/** @type {Record<string, boolean>} */
		const perms = {}
		for (const p of PERMISSION_ORDER) perms[p] = true
		return perms
	}

	let bits = baseBits
	const channelOverride = channelPermissions?.[channelId]
	if (channelOverride) {
		// 2. 频道内 @everyone 覆写（最宽频道层）：先去 deny 再叠 allow。
		const everyone = channelOverride['@everyone']
		if (everyone)
			bits = (bits & ~encodePermissions(everyone.deny)) | encodePermissions(everyone.allow)

		// 3. 频道内具体角色覆写：合并成员所有非 @everyone 角色的 allow/deny 后整体应用
		//    （避免角色遍历顺序敏感），再次先去 deny 再叠 allow，使更具体的 allow 可覆盖 @everyone deny。
		let roleAllow = 0n
		let roleDeny = 0n
		for (const roleId of roleIds) {
			if (roleId === '@everyone') continue
			const override = channelOverride[roleId]
			if (!override) continue
			roleAllow |= encodePermissions(override.allow)
			roleDeny |= encodePermissions(override.deny)
		}
		bits = (bits & ~roleDeny) | roleAllow
	}

	return decodePermissions(bits)
}

/**
 * 检查成员是否有指定权限
 * @param {object} member 成员对象
 * @param {string} permission 权限名称
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {boolean} 是否具备权限
 */
export function hasPermission(member, permission, roles, channelId, channelPermissions) {
	const permissions = calculateMemberPermissions(member, roles, channelId, channelPermissions)
	return permissions[permission] === true
}

/**
 * 创建默认角色
 * @returns {object} `@everyone`、`founder`、`admin` 默认角色
 */
export function createDefaultRoles() {
	return {
		'@everyone': {
			name: 'Everyone',
			color: '#99AAB5',
			position: 0,
			permissions: {
				VIEW_CHANNEL: true,
				SEND_MESSAGES: true,
				SEND_STICKERS: true,
				ADD_REACTIONS: true,
				STREAM: true,
			},
			isDefault: true,
			isHoisted: false,
		},
		founder: {
			name: 'Founder',
			color: '#E67E22',
			position: 200,
			permissions: {
				MANAGE_ADMINS: true,
				ADMIN: true,
				BYPASS_RATE_LIMIT: true,
			},
			isDefault: false,
			isHoisted: true,
		},
		admin: {
			name: 'Admin',
			color: '#E74C3C',
			position: 100,
			permissions: {
				ADMIN: true,
				BYPASS_RATE_LIMIT: true,
			},
			isDefault: false,
			isHoisted: true,
		},
	}
}
