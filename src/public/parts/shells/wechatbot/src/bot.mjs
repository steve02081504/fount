import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../../scripts/i18n.mjs'
import { getAllUserNames } from '../../../../../server/auth.mjs'
import { events } from '../../../../../server/events.mjs'
import { EndJob, StartJob } from '../../../../../server/jobs.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, loadTempData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

import { createWechatApi, DEFAULT_WECHAT_ILINK_BASE } from './wechat_api.mjs'

/** @typedef {import('../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */

/**
 * 确保角色具有微信接口，如果未实现则回退到内置的简单实现。
 * @param {CharAPI_t} char 角色实例。
 * @param {string} username 用户名。
 * @param {string} charname 角色名称。
 * @returns {Promise<void>}
 */
async function ensureWechatInterface(char, username, charname) {
	if (!char.interfaces.wechat) {
		const { createSimpleWechatInterface } = await import('./default_interface/main.mjs')
		char.interfaces.wechat = createSimpleWechatInterface(char, username, charname)
	}
}

/**
 * 启动机器人。
 * @param {{
 * 	token: string,
 * 	apiBaseUrl: string,
 * 	config: object
 * }} config 机器人配置对象。
 * @param {CharAPI_t} char 角色实例。
 * @param {string} username 用户名。
 * @param {string} charname 角色名称。
 * @returns {Promise<void>}
 */
async function startBot(config, char, username, charname) {
	const abortController = new AbortController()
	const cdnBaseUrl = config.apiBaseUrl?.trim() || DEFAULT_WECHAT_ILINK_BASE
	const api = createWechatApi({
		baseUrl: cdnBaseUrl,
		token: config.token,
		signal: abortController.signal,
	})

	await ensureWechatInterface(char, username, charname)

	const ctx = { ...api, signal: abortController.signal, cdnBaseUrl }
	const loopPromise = char.interfaces.wechat.OnceClientReady(ctx, config.config)

	void loopPromise.catch(err => {
		if (!abortController.signal.aborted)
			console.error('[WeChatBot] 轮询结束:', err)
	})

	return {
		/**
		 * 销毁机器人。
		 * @returns {Promise<void>}
		 */
		destroy: async () => {
			abortController.abort()
			await loopPromise.catch(() => {})
		},
	}
}

/**
 * 获取机器人缓存。
 * @param {any} username 用户名。
 * @returns {object} 机器人缓存。
 */
function getBotCache(username) {
	return loadTempData(username, 'wechatbot_cache')
}

/**
 * 获取机器人配置。
 * @param {any} username 用户名。
 * @returns {object} 机器人配置。
 */
function getBotsData(username) {
	return loadShellData(username, 'wechatbot', 'bot_configs')
}

/**
 * 获取指定用户的特定微信 Bot 的配置。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {object} 机器人配置。
 */
export function getBotConfig(username, botname) {
	return getBotsData(username)[botname] || {}
}

/**
 * 获取指定用户的特定微信 Bot 的配置模板。
 * @param {string} username 用户名。
 * @param {string} charname 角色名称。
 * @returns {Promise<object>} 机器人配置模板。
 */
export async function getBotConfigTemplate(username, charname) {
	const char = await loadPart(username, 'chars/' + charname)
	await ensureWechatInterface(char, username, charname)
	return await char.interfaces.wechat?.GetBotConfigTemplate?.() || {}
}

/**
 * 设置指定用户的特定微信 Bot 的配置。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @param {object} config 配置对象。
 * @returns {void}
 */
export function setBotConfig(username, botname, config) {
	getBotsData(username)[botname] = config
	saveShellData(username, 'wechatbot', 'bot_configs')
}

/**
 * 删除指定用户的特定微信 Bot 的配置。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {void}
 */
export function deleteBotConfig(username, botname) {
	delete getBotsData(username)[botname]
	saveShellData(username, 'wechatbot', 'bot_configs')
}

/**
 * 停止运行中的机器人会话并将其从缓存中删除。
 * 不调用 EndJob；使用 stopBot 代替。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>}
 */
async function destroyBotSession(username, botname) {
	const botCache = getBotCache(username)
	if (!botCache[botname]) return

	try {
		const handle = await botCache[botname]
		await handle.destroy()
	}
	finally {
		delete botCache[botname]
	}
}

/**
 * 运行机器人。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>}
 */
export async function runBot(username, botname) {
	const botCache = getBotCache(username)
	if (botCache[botname]) return

	botCache[botname] = (async () => {
		const config = getBotConfig(username, botname)
		if (!Object.keys(config).length) throw new Error(`Bot ${botname} not found`)
		if (!config.token?.trim())
			throw new Error('微信 Bot 需要 Token：请使用扫码登录或粘贴 Bot Token')

		const char = await loadPart(username, 'chars/' + config.char)
		return startBot(config, char, username, config.char)
	})()

	try {
		botCache[botname] = await botCache[botname]
		StartJob(username, 'shells/wechatbot', botname)
		unlockAchievement(username, 'shells/wechatbot', 'start_bot')
	}
	catch (error) {
		delete botCache[botname]
		throw error
	}
}

/**
 * 停止机器人。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>}
 */
export async function stopBot(username, botname) {
	await destroyBotSession(username, botname)
	EndJob(username, 'shells/wechatbot', botname)
}

/**
 * 暂停机器人。
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {Promise<void>}
 */
export async function pauseBot(username, botname) {
	await destroyBotSession(username, botname)
}

on_shutdown(() => Promise.all(
	getAllUserNames().flatMap(username =>
		Object.keys(getBotCache(username)).map(botname =>
			pauseBot(username, botname).catch(console.error)
		)
	)
))

/**
 * 获取运行中的机器人列表。
 * @param {any} username 用户名。
 * @returns {string[]} 运行中的机器人列表。
 */
export function getRunningBotList(username) {
	return Object.keys(getBotCache(username))
}

/**
 * 获取机器人列表。
 * @param {string} username 用户名。
 * @returns {string[]} 机器人列表。
 */
export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

/**
 * 停止所有运行中的机器人。
 * @param {string} username 用户名。
 * @returns {Promise<void>}
 */
async function stopAllRunningBots(username) {
	await Promise.all(getRunningBotList(username).map(botname =>
		stopBot(username, botname).catch(error =>
			console.error(`WeChat Bot: Error stopping bot ${botname} for ${username}:`, error)
		)
	))
}

events.on('BeforeUserDeleted', ({ username }) =>
	stopAllRunningBots(username, `deleted user ${username}`)
)

events.on('BeforeUserRenamed', ({ oldUsername }) =>
	stopAllRunningBots(oldUsername, `old username ${oldUsername}`)
)
