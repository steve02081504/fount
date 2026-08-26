/**
 * Chat 群权限预设（Discord 式频道覆写语义）。
 */
import { createLayeredEvaluator } from 'npm:@steve02081504/fount-p2p/permissions'

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
	MENTION_EVERYONE: 'MENTION_EVERYONE',
	ADMIN: 'ADMIN',
	BYPASS_RATE_LIMIT: 'BYPASS_RATE_LIMIT',
}

/** 群级治理权限：作用于群权限 scope，不出现在频道权限覆写中。 */
export const GROUP_PERMISSIONS = [
	PERMISSIONS.KICK_MEMBERS,
	PERMISSIONS.BAN_MEMBERS,
	PERMISSIONS.MANAGE_ROLES,
	PERMISSIONS.MANAGE_ADMINS,
	PERMISSIONS.INVITE_MEMBERS,
]

/** 频道级权限：可写入频道权限覆写。 */
export const CHANNEL_PERMISSIONS = [
	PERMISSIONS.VIEW_CHANNEL,
	PERMISSIONS.SEND_MESSAGES,
	PERMISSIONS.SEND_STICKERS,
	PERMISSIONS.ADD_REACTIONS,
	PERMISSIONS.MANAGE_MESSAGES,
	PERMISSIONS.MANAGE_CHANNELS,
	PERMISSIONS.STREAM,
	PERMISSIONS.CREATE_THREADS,
	PERMISSIONS.UPLOAD_FILES,
	PERMISSIONS.MANAGE_FILES,
	PERMISSIONS.PIN_MESSAGES,
	PERMISSIONS.MENTION_EVERYONE,
]

/** 超管位：只能通过角色基础权限授予，不进入任何频道/群权限覆写。 */
export const SUPERUSER_PERMISSIONS = [
	PERMISSIONS.ADMIN,
	PERMISSIONS.MANAGE_ADMINS,
	PERMISSIONS.BYPASS_RATE_LIMIT,
]

/** 群权限 scope 求值用的固定 id（区别于频道 id）。 */
export const GROUP_SCOPE_ID = '@group'

/**
 * 判断权限键是否属于群级治理权限（可用于群权限覆写）。
 * @param {string} permission 权限键
 * @returns {boolean} 是否群级治理权限
 */
export function isGroupPermission(permission) {
	return GROUP_PERMISSIONS.includes(permission)
}

/**
 * 判断权限键是否属于频道级权限（可用于频道权限覆写）。
 * @param {string} permission 权限键
 * @returns {boolean} 是否频道级权限
 */
export function isChannelPermission(permission) {
	return CHANNEL_PERMISSIONS.includes(permission)
}

const chatEvaluator = createLayeredEvaluator({
	order: Object.values(PERMISSIONS),
	superuserName: PERMISSIONS.ADMIN,
	everyoneRoleId: '@everyone',
})

/** 权限位编码。 */
export const encodePermissions = chatEvaluator.encode
/** 权限位解码。 */
export const decodePermissions = chatEvaluator.decode

/**
 * @param {object} member 成员对象
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {Record<string, boolean>} 最终权限 Record
 */
export function calculateMemberPermissions(member, roles, channelId, channelPermissions) {
	return chatEvaluator.calculate(member, roles, channelId, channelPermissions)
}

/**
 * @param {object} member 成员对象
 * @param {string} permission 权限名称
 * @param {object} roles 角色映射
 * @param {string} channelId 频道 ID
 * @param {object} channelPermissions 频道权限覆写
 * @returns {boolean} 是否具备权限
 */
export function hasPermission(member, permission, roles, channelId, channelPermissions) {
	return chatEvaluator.has(member, permission, roles, channelId, channelPermissions)
}

/**
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
				UPLOAD_FILES: true,
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
				MENTION_EVERYONE: true,
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
				MENTION_EVERYONE: true,
			},
			isDefault: false,
			isHoisted: true,
		},
	}
}
