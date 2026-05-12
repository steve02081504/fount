/**
 * 权限系统
 * 物化权限状态 + 增量计算
 */

// 内置权限能力
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
	ADMIN: 'ADMIN'
}

// 权限顺序（用于 BigInt 编码）
const PERMISSION_ORDER = Object.values(PERMISSIONS)

/**
 * 权限编码为 BigInt
 * @param {Record<string, boolean>} permissions - 权限对象
 * @returns {bigint}
 */
export function encodePermissions(permissions) {
	let bits = 0n
	for (let i = 0; i < PERMISSION_ORDER.length; i++) {
		if (permissions[PERMISSION_ORDER[i]]) {
			bits |= (1n << BigInt(i))
		}
	}
	return bits
}

/**
 * BigInt 解码为权限对象
 * @param {bigint} bits - 权限位
 * @returns {Record<string, boolean>}
 */
export function decodePermissions(bits) {
	const permissions = {}
	for (let i = 0; i < PERMISSION_ORDER.length; i++) {
		permissions[PERMISSION_ORDER[i]] = Boolean(bits & (1n << BigInt(i)))
	}
	return permissions
}

/**
 * 计算成员的最终权限
 * @param {object} member - 成员对象
 * @param {object} roles - 角色映射
 * @param {string} channelId - 频道ID
 * @param {object} channelPermissions - 频道权限覆写
 * @returns {Record<string, boolean>}
 */
export function calculateMemberPermissions(member, roles, channelId, channelPermissions) {
	// 检查是否有 ADMIN 权限
	for (const roleId of member.roles || []) {
		const role = roles[roleId]
		if (role && role.permissions.ADMIN) {
			// ADMIN 绕过所有限制
			const adminPerms = {}
			for (const perm of PERMISSION_ORDER) {
				adminPerms[perm] = true
			}
			return adminPerms
		}
	}

	// 收集所有角色权限
	let roleBits = 0n
	for (const roleId of member.roles || []) {
		const role = roles[roleId]
		if (role) {
			roleBits |= encodePermissions(role.permissions)
		}
	}

	// 应用频道覆写
	const channelOverride = channelPermissions?.[channelId]
	if (channelOverride) {
		for (const roleId of member.roles || []) {
			const override = channelOverride[roleId]
			if (override) {
				const allowBits = encodePermissions(override.allow || {})
				const denyBits = encodePermissions(override.deny || {})
				roleBits = (roleBits | allowBits) & ~denyBits
			}
		}
	}

	return decodePermissions(roleBits)
}

/**
 * 检查成员是否有指定权限
 * @param {object} member - 成员对象
 * @param {string} permission - 权限名称
 * @param {object} roles - 角色映射
 * @param {string} channelId - 频道ID
 * @param {object} channelPermissions - 频道权限覆写
 * @returns {boolean}
 */
export function hasPermission(member, permission, roles, channelId, channelPermissions) {
	const permissions = calculateMemberPermissions(member, roles, channelId, channelPermissions)
	return permissions[permission] === true
}

/**
 * 创建默认角色
 * @returns {object}
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
				STREAM: true
			},
			isDefault: true,
			isHoisted: false
		},
		'admin': {
			name: 'Admin',
			color: '#E74C3C',
			position: 100,
			permissions: {
				ADMIN: true
			},
			isDefault: false,
			isHoisted: true
		}
	}
}
