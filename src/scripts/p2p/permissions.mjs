/**
 * 权限系统（§8）：物化权限 + 频道 allow/deny；ADMIN 不受治理类 deny 锁死，SEND_* deny 仍生效。
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

/** 频道 deny 对 ADMIN 仍生效的发送类能力（§8 第 2 步） */
const SEND_CLASS_DENY_ALWAYS = new Set([
	PERMISSIONS.SEND_MESSAGES,
	PERMISSIONS.SEND_STICKERS,
	PERMISSIONS.ADD_REACTIONS,
])

/** 频道 deny 对 ADMIN 无效或可自解的治理类能力（§8 第 3 步） */
const GOVERNANCE_DENY_ADMIN_IMMUNE = new Set([
	PERMISSIONS.MANAGE_ROLES,
	PERMISSIONS.MANAGE_ADMINS,
	PERMISSIONS.MANAGE_CHANNELS,
	PERMISSIONS.KICK_MEMBERS,
	PERMISSIONS.BAN_MEMBERS,
	PERMISSIONS.MANAGE_FILES,
	PERMISSIONS.MANAGE_MESSAGES,
	PERMISSIONS.INVITE_MEMBERS,
	PERMISSIONS.PIN_MESSAGES,
	PERMISSIONS.UPLOAD_FILES,
])

/**
 * 权限编码为 BigInt
 * @param {Record<string, boolean>} permissions 权限对象
 * @returns {bigint} 按位编码
 */
export function encodePermissions(permissions) {
	let bits = 0n
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
 * 收集频道覆写中对某成员生效的 deny 键（多角色合并）。
 * @param {string[]} roleIds 成员角色 id 列表
 * @param {Record<string, { allow?: Record<string, boolean>, deny?: Record<string, boolean> }>} channelOverride 频道覆写
 * @returns {Record<string, boolean>} 合并后的 deny 表
 */
function mergedChannelDeny(roleIds, channelOverride) {
	/** @type {Record<string, boolean>} */
	const deny = {}
	if (!channelOverride) return deny
	for (const roleId of roleIds) {
		const ov = channelOverride[roleId]
		if (!ov?.deny) continue
		for (const [k, v] of Object.entries(ov.deny))
			if (v) deny[k] = true
	}
	return deny
}

/**
 * 计算成员在频道内的最终权限（§8 三步折叠）。
 * @param {object} member 成员对象
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {Record<string, boolean>} 最终权限 Record
 */
export function calculateMemberPermissions(member, roles, channelId, channelPermissions) {
	const roleIds = member.roles
	let roleBits = 0n
	for (const roleId of roleIds) {
		const role = roles[roleId]
		if (role)
			roleBits |= encodePermissions(role.permissions)
	}

	const channelOverride = channelPermissions?.[channelId]
	if (channelOverride)
		for (const roleId of roleIds) {
			const override = channelOverride[roleId]
			if (override) {
				const allowBits = encodePermissions(override.allow)
				const denyBits = encodePermissions(override.deny)
				roleBits = (roleBits | allowBits) & ~denyBits
			}
		}

	const perms = decodePermissions(roleBits)
	const isAdmin = perms.ADMIN === true

	const channelDeny = mergedChannelDeny(roleIds, channelOverride)
	for (const [key, denied] of Object.entries(channelDeny)) {
		if (!denied) continue
		if (SEND_CLASS_DENY_ALWAYS.has(key)) {
			perms[key] = false
			continue
		}
		if (isAdmin && GOVERNANCE_DENY_ADMIN_IMMUNE.has(key))
			continue
		perms[key] = false
	}

	if (isAdmin) {
		for (const p of PERMISSION_ORDER)
			if (!SEND_CLASS_DENY_ALWAYS.has(p) || !channelDeny[p])
				perms[p] = true
		for (const p of SEND_CLASS_DENY_ALWAYS)
			if (channelDeny[p]) perms[p] = false
	}

	return perms
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
