import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @typedef {import('../../decl/chatAuxAPI.ts').ChannelConfig} ChannelConfig */
/** @typedef {import('../../decl/chatAuxAPI.ts').ChannelMessage} ChannelMessage */
/** @typedef {import('../../decl/chatAuxAPI.ts').ChannelMember} ChannelMember */
/** @typedef {import('../../decl/chatAuxAPI.ts').ChannelRole} ChannelRole */
/** @typedef {import('../../decl/chatAuxAPI.ts').ChannelPermission} ChannelPermission */

const CHANNELS_DIR = path.join(process.cwd(), 'data', 'channels')

// 确保频道目录存在
if (!fs.existsSync(CHANNELS_DIR)) 
	fs.mkdirSync(CHANNELS_DIR, { recursive: true })


/**
 * 获取频道配置文件路径
 * @param {string} channelId - 频道ID
 * @returns {string} 频道 config.json 的绝对路径
 */
function getChannelConfigPath(channelId) {
	return path.join(CHANNELS_DIR, channelId, 'config.json')
}

/**
 * 获取频道消息文件路径
 * @param {string} channelId - 频道ID
 * @returns {string} 频道 messages.json 的绝对路径
 */
function getChannelMessagesPath(channelId) {
	return path.join(CHANNELS_DIR, channelId, 'messages.json')
}

/**
 * 获取频道成员文件路径
 * @param {string} channelId - 频道ID
 * @returns {string} 频道 members.json 的绝对路径
 */
function getChannelMembersPath(channelId) {
	return path.join(CHANNELS_DIR, channelId, 'members.json')
}

/**
 * 创建频道
 * @param {string} username - 用户名
 * @param {Partial<ChannelConfig>} config - 频道配置
 * @returns {Promise<ChannelConfig>} 新建频道的完整配置
 */
export async function createChannel(username, config) {
	const channelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	const channelDir = path.join(CHANNELS_DIR, channelId)

	// 创建频道目录
	if (!fs.existsSync(channelDir)) 
		fs.mkdirSync(channelDir, { recursive: true })
	

	const channelConfig = {
		channelId,
		name: config.name || '未命名频道',
		description: config.description || '',
		avatar: config.avatar || '',
		type: config.type || 'announcement',
		owner: username,
		admins: config.admins || [],
		subscribers: [username],
		permissions: {
			canPost: config.permissions?.canPost || [username],
			canComment: config.permissions?.canComment ?? false,
			isPublic: config.permissions?.isPublic ?? true
		},
		createdAt: Date.now(),
		updatedAt: Date.now()
	}

	// 保存频道配置
	await saveJsonFile(getChannelConfigPath(channelId), channelConfig)

	// 初始化消息列表
	await saveJsonFile(getChannelMessagesPath(channelId), [])

	// 初始化成员列表
	const members = [
		{
			username,
			role: 'owner',
			joinedAt: Date.now()
		}
	]
	await saveJsonFile(getChannelMembersPath(channelId), members)

	return channelConfig
}

/**
 * 获取频道配置
 * @param {string} channelId - 频道ID
 * @returns {Promise<ChannelConfig>} 频道配置对象
 */
export async function getChannel(channelId) {
	const configPath = getChannelConfigPath(channelId)
	if (!fs.existsSync(configPath)) 
		throw new Error('Channel not found')
	
	return await loadJsonFile(configPath)
}

/**
 * 获取用户的频道列表
 * @param {string} username - 用户名
 * @returns {Promise<ChannelConfig[]>} 用户可见的频道配置列表
 */
export async function getChannelList(username) {
	const channels = []

	if (!fs.existsSync(CHANNELS_DIR)) 
		return channels
	

	const channelDirs = fs.readdirSync(CHANNELS_DIR)

	for (const channelId of channelDirs) 
		try {
			const config = await getChannel(channelId)
			// 只返回用户订阅的或公开的频道
			if (config.subscribers.includes(username) || config.permissions.isPublic) 
				channels.push(config)
			
		} catch (error) {
			console.error(`Error loading channel ${channelId}:`, error)
		}
	

	return channels
}

/**
 * 更新频道配置
 * @param {string} channelId - 频道ID
 * @param {Partial<ChannelConfig>} updates - 更新内容
 * @returns {Promise<ChannelConfig>} 合并更新后的频道配置
 */
export async function updateChannel(channelId, updates) {
	const config = await getChannel(channelId)

	const updatedConfig = {
		...config,
		...updates,
		permissions: {
			...config.permissions,
			...updates.permissions || {}
		},
		channelId,
		owner: config.owner,
		subscribers: config.subscribers,
		admins: config.admins,
		createdAt: config.createdAt,
		updatedAt: Date.now()
	}

	await saveJsonFile(getChannelConfigPath(channelId), updatedConfig)
	return updatedConfig
}

/**
 * 删除频道
 * @param {string} channelId - 频道ID
 * @returns {Promise<void>} 无返回值
 */
export async function deleteChannel(channelId) {
	const channelDir = path.join(CHANNELS_DIR, channelId)
	if (fs.existsSync(channelDir)) 
		fs.rmSync(channelDir, { recursive: true, force: true })
	
}

/**
 * 订阅频道
 * @param {string} username - 用户名
 * @param {string} channelId - 频道ID
 * @param {string} [greeting] - 入群欢迎语（可选）
 * @returns {Promise<void>} 无返回值
 */
export async function subscribeChannel(username, channelId, greeting = null) {
	const config = await getChannel(channelId)

	if (config.subscribers.includes(username)) 
		throw new Error('Already subscribed')
	

	config.subscribers.push(username)
	config.updatedAt = Date.now()

	await saveJsonFile(getChannelConfigPath(channelId), config)

	// 添加到成员列表
	const members = await loadJsonFile(getChannelMembersPath(channelId))
	members.push({
		username,
		role: 'subscriber',
		joinedAt: Date.now()
	})
	await saveJsonFile(getChannelMembersPath(channelId), members)

	// 写入系统欢迎消息（绕过权限检查；为空则跳过）
	if (greeting && typeof greeting === 'string') 
		try {
			await postMessage(channelId, {
				author: username,
				content: `[join:${greeting}]`,
				files: []
			})
		} catch { /* 忽略写入失败 */ }
	
}

/**
 * 取消订阅频道
 * @param {string} username - 用户名
 * @param {string} channelId - 频道ID
 * @returns {Promise<void>} 无返回值
 */
export async function unsubscribeChannel(username, channelId) {
	const config = await getChannel(channelId)

	if (!config.subscribers.includes(username)) 
		throw new Error('Not subscribed')
	

	if (config.owner === username) 
		throw new Error('Owner cannot unsubscribe')
	

	config.subscribers = config.subscribers.filter(u => u !== username)
	config.updatedAt = Date.now()

	await saveJsonFile(getChannelConfigPath(channelId), config)

	const members = await loadJsonFile(getChannelMembersPath(channelId))
	const updatedMembers = members.filter(m => m.username !== username)
	await saveJsonFile(getChannelMembersPath(channelId), updatedMembers)
}

/**
 * 发布消息到频道
 * @param {string} channelId - 频道ID
 * @param {Partial<ChannelMessage>} message - 消息内容
 * @returns {Promise<ChannelMessage>} 持久化后的完整消息对象
 */
export async function postMessage(channelId, message) {
	const messages = await loadJsonFile(getChannelMessagesPath(channelId))

	const newMessage = {
		messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		channelId,
		author: message.author,
		content: message.content || '',
		files: message.files || [],
		isPinned: message.isPinned || false,
		createdAt: Date.now()
	}

	messages.push(newMessage)
	await saveJsonFile(getChannelMessagesPath(channelId), messages)

	return newMessage
}

/**
 * 获取频道消息列表
 * @param {string} channelId - 频道ID
 * @param {number} start - 起始位置
 * @param {number} limit - 数量限制
 * @returns {Promise<ChannelMessage[]>} 分页后的消息数组
 */
export async function getMessages(channelId, start = 0, limit = 50) {
	const messages = await loadJsonFile(getChannelMessagesPath(channelId))
	return messages.slice(start, start + limit)
}

/**
 * 获取用户在频道中的角色
 * @param {string} username - 用户名
 * @param {string} channelId - 频道ID
 * @returns {Promise<ChannelRole | null>} 用户在频道中的角色，未加入则为 null
 */
export async function getUserRole(username, channelId) {
	const config = await getChannel(channelId)

	if (config.owner === username) return 'owner'
	if (config.admins.includes(username)) return 'admin'

	const members = await loadJsonFile(getChannelMembersPath(channelId))
	const member = members.find(m => m.username === username)

	return member ? member.role : null
}

/**
 * 获取频道成员列表
 * @param {string} channelId - 频道ID
 * @returns {Promise<ChannelMember[]>} 成员列表，文件不存在时为空数组
 */
export async function getChannelMembers(channelId) {
	const membersPath = getChannelMembersPath(channelId)
	if (!fs.existsSync(membersPath)) return []
	return await loadJsonFile(membersPath)
}

/**
 * 检查用户权限
 * @param {string} username - 用户名
 * @param {string} channelId - 频道ID
 * @param {ChannelPermission} permission - 权限类型
 * @returns {Promise<boolean>} 是否具备该权限
 */
export async function checkPermission(username, channelId, permission) {
	const role = await getUserRole(username, channelId)

	if (!role) return false

	const permissions = {
		owner: ['canPost', 'canEdit', 'canDelete', 'canPin', 'canInvite', 'canRemove', 'canManageRoles', 'canEditChannel', 'canDeleteChannel', 'canViewHistory'],
		admin: ['canPost', 'canEdit', 'canDelete', 'canPin', 'canInvite', 'canRemove', 'canViewHistory'],
		moderator: ['canPost', 'canEdit', 'canPin', 'canViewHistory'],
		member: ['canPost', 'canViewHistory'],
		subscriber: ['canPost', 'canViewHistory']
	}

	return permissions[role]?.includes(permission) || false
}
