/**
 * 权限系统（§8）：物化权限 + 频道 allow/deny；ADMIN/OWNER 不受治理类 deny 锁死，但 SEND_* 类 deny 仍生效。
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
	INVITE_MEMBERS: 'INVITE_MEMBERS',
	STREAM: 'STREAM',
	CREATE_THREADS: 'CREATE_THREADS',
	UPLOAD_FILES: 'UPLOAD_FILES',
	MANAGE_FILES: 'MANAGE_FILES',
	PIN_MESSAGES: 'PIN_MESSAGES',
	ADMIN: 'ADMIN',
	OWNER: 'OWNER',
}

const PERMISSION_ORDER = Object.values(PERMISSIONS)

/** 频道 deny 对 ADMIN/OWNER 仍生效的发送类能力（§8） */
const SEND_CLASS_DENY_ALWAYS = new Set([
	PERMISSIONS.SEND_MESSAGES,
	PERMISSIONS.SEND_STICKERS,
	PERMISSIONS.ADD_REACTIONS,
])

/**
 * 权限编码为 BigInt
 * @param {Record<string, boolean>} permissions 权限对象
 * @returns {bigint} 按位编码
 */
export function encodePermissions(permissions) {
	let bits = 0n
	for (let i = 0; i < PERMISSION_ORDER.length; i++)
		if (permissions[PERMISSION_ORDER[i]])
			bits |= 1n << BigInt(i)
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
	for (let i = 0; i < PERMISSION_ORDER.length; i++)
		permissions[PERMISSION_ORDER[i]] = Boolean(bits & (1n << BigInt(i)))
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
 * 计算成员在频道内的最终权限（§8 语法确定性折叠）。
 * @param {object} member 成员对象
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {Record<string, boolean>} 最终权限 Record
 */
export function calculateMemberPermissions(member, roles, channelId, channelPermissions) {
	const roleIds = member.roles || []
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
				const allowBits = encodePermissions(override.allow || {})
				const denyBits = encodePermissions(override.deny || {})
				roleBits = (roleBits | allowBits) & ~denyBits
			}
		}

	const perms = decodePermissions(roleBits)
	const isPrivileged = perms.ADMIN === true || perms.OWNER === true

	if (isPrivileged) 
		for (const p of PERMISSION_ORDER)
			perms[p] = true
	

	const channelDeny = mergedChannelDeny(roleIds, channelOverride)
	for (const [key, denied] of Object.entries(channelDeny)) {
		if (!denied) continue
		if (SEND_CLASS_DENY_ALWAYS.has(key)) {
			perms[key] = false
			continue
		}
		if (!isPrivileged)
			perms[key] = false
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
 * @returns {object} `@everyone` 与 `admin` 的默认角色配置
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
		admin: {
			name: 'Admin',
			color: '#E74C3C',
			position: 100,
			permissions: {
				ADMIN: true,
			},
			isDefault: false,
			isHoisted: true,
		},
	}
}
