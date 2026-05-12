import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @typedef {import('../../decl/chatAuxAPI.ts').UserProfile} UserProfile */
/** @typedef {import('../../decl/chatAuxAPI.ts').UserStatus} UserStatus */

/**
 * 获取用户资料文件路径
 * @param {string} username - 用户名
 * @returns {string} profile.json 的绝对路径
 */
function getProfilePath(username) {
	return path.join(process.cwd(), 'data', 'users', username, 'profile.json')
}

/**
 * 获取默认资料
 * @param {string} username - 用户名
 * @returns {UserProfile} 合并默认值后的资料对象
 */
function getDefaultProfile(username) {
	return {
		username,
		displayName: username,
		avatar: '',
		bio: '',
		email: '',
		status: 'online',
		customStatus: '',
		preferences: {
			language: 'zh-CN',
			theme: 'auto',
			notifications: {
				email: true,
				push: true,
				sound: true
			}
		},
		social: {
			website: '',
			github: '',
			twitter: ''
		},
		stats: {
			joinedAt: Date.now(),
			messageCount: 0,
			groupCount: 0,
			channelCount: 0
		},
		privacy: {
			showEmail: false,
			showStats: true,
			allowDirectMessages: true
		}
	}
}

/**
 * 获取用户资料
 * @param {string} username - 用户名
 * @returns {Promise<UserProfile>} 持久化或默认合并后的用户资料
 */
export async function getProfile(username) {
	const profilePath = getProfilePath(username)

	// 如果资料文件不存在，创建默认资料
	if (!fs.existsSync(profilePath)) {
		const defaultProfile = getDefaultProfile(username)
		const userDir = path.dirname(profilePath)
		if (!fs.existsSync(userDir)) 
			fs.mkdirSync(userDir, { recursive: true })
		
		await saveJsonFile(profilePath, defaultProfile)
		return defaultProfile
	}

	const profile = await loadJsonFile(profilePath)

	// 合并默认值，确保所有字段都存在
	const defaultProfile = getDefaultProfile(username)
	return {
		...defaultProfile,
		...profile,
		preferences: {
			...defaultProfile.preferences,
			...profile.preferences,
			notifications: {
				...defaultProfile.preferences.notifications,
				...profile.preferences?.notifications
			}
		},
		social: {
			...defaultProfile.social,
			...profile.social
		},
		stats: {
			...defaultProfile.stats,
			...profile.stats
		},
		privacy: {
			...defaultProfile.privacy,
			...profile.privacy
		}
	}
}

/**
 * 更新用户资料
 * @param {string} username - 用户名
 * @param {Partial<UserProfile>} updates - 更新内容
 * @returns {Promise<UserProfile>} 写入磁盘后的完整资料
 */
export async function updateProfile(username, updates) {
	const profile = await getProfile(username)

	// 深度合并更新
	const updatedProfile = {
		...profile,
		...updates,
		username, // 确保用户名不被修改
		preferences: updates.preferences ? {
			...profile.preferences,
			...updates.preferences,
			notifications: updates.preferences.notifications ? {
				...profile.preferences.notifications,
				...updates.preferences.notifications
			} : profile.preferences.notifications
		} : profile.preferences,
		social: updates.social ? {
			...profile.social,
			...updates.social
		} : profile.social,
		stats: updates.stats ? {
			...profile.stats,
			...updates.stats
		} : profile.stats,
		privacy: updates.privacy ? {
			...profile.privacy,
			...updates.privacy
		} : profile.privacy
	}

	await saveJsonFile(getProfilePath(username), updatedProfile)
	return updatedProfile
}

/**
 * 上传头像
 * @param {string} username - 用户名
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @returns {Promise<string>} 可访问的头像 URL
 */
export async function uploadAvatar(username, fileBuffer, filename) {
	const avatarDir = path.join(process.cwd(), 'data', 'uploads', 'avatars')

	if (!fs.existsSync(avatarDir)) 
		fs.mkdirSync(avatarDir, { recursive: true })
	

	// 生成唯一文件名
	const ext = path.extname(filename)
	const uniqueFilename = `${username}_${Date.now()}${ext}`
	const avatarPath = path.join(avatarDir, uniqueFilename)

	// 保存文件
	fs.writeFileSync(avatarPath, fileBuffer)

	// 返回相对URL
	const avatarUrl = `/uploads/avatars/${uniqueFilename}`

	// 更新用户资料
	await updateProfile(username, { avatar: avatarUrl })

	return avatarUrl
}

/**
 * 获取用户统计
 * @param {string} username - 用户名
 * @returns {Promise<UserProfile['stats']>} 用户统计字段快照
 */
export async function getStats(username) {
	const profile = await getProfile(username)
	return profile.stats
}

/**
 * 更新用户统计
 * @param {string} username - 用户名
 * @param {Partial<UserProfile['stats']>} stats - 统计数据
 * @returns {Promise<void>} 无返回值
 */
export async function updateStats(username, stats) {
	const profile = await getProfile(username)
	profile.stats = {
		...profile.stats,
		...stats
	}
	await saveJsonFile(getProfilePath(username), profile)
}

/**
 * 更新用户状态
 * @param {string} username - 用户名
 * @param {UserStatus} status - 状态
 * @param {string} customStatus - 自定义状态
 * @returns {Promise<void>} 无返回值
 */
export async function updateStatus(username, status, customStatus = '') {
	await updateProfile(username, {
		status,
		customStatus
	})
}

/**
 * 增加消息计数
 * @param {string} username - 用户名
 * @returns {Promise<void>} 无返回值
 */
export async function incrementMessageCount(username) {
	const profile = await getProfile(username)
	profile.stats.messageCount++
	await saveJsonFile(getProfilePath(username), profile)
}

/**
 * 增加群组计数
 * @param {string} username - 用户名
 * @returns {Promise<void>} 无返回值
 */
export async function incrementGroupCount(username) {
	const profile = await getProfile(username)
	profile.stats.groupCount++
	await saveJsonFile(getProfilePath(username), profile)
}

/**
 * 增加频道计数
 * @param {string} username - 用户名
 * @returns {Promise<void>} 无返回值
 */
export async function incrementChannelCount(username) {
	const profile = await getProfile(username)
	profile.stats.channelCount++
	await saveJsonFile(getProfilePath(username), profile)
}
