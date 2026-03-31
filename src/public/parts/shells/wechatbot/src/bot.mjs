import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../../scripts/i18n.mjs'
import { getAllUserNames } from '../../../../../server/auth.mjs'
import { events } from '../../../../../server/events.mjs'
import { EndJob, StartJob } from '../../../../../server/jobs.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, loadTempData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'

import { createWeixinApi, DEFAULT_WEIXIN_ILINK_BASE } from './weixin_api.mjs'

/** @typedef {import('../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */

/**
 * Ensures the char has a weixin interface, falling back to the built-in simple implementation.
 * @param {CharAPI_t} char 角色实例。
 * @param {string} username 用户名。
 * @param {string} charname 角色名称。
 * @returns {Promise<any>} 返回值。
 */
async function ensureWeixinInterface(char, username, charname) {
	if (!char.interfaces.weixin) {
		const { createSimpleWeixinInterface } = await import('./default_interface/main.mjs')
		char.interfaces.weixin = createSimpleWeixinInterface(char, username, charname)
	}
}

/**
 * @param {{
 * 	token: string,
 * 	apiBaseUrl: string,
 * 	config: any
 * }} config 机器人配置对象。
 * @param {CharAPI_t} char 角色实例。
 * @param {string} username 用户名。
 * @param {string} charname 角色名称。
 * @returns {Promise<any>} 返回值。
 */
async function startBot(config, char, username, charname) {
	const abortController = new AbortController()
	const api = createWeixinApi({
		baseUrl: config.apiBaseUrl?.trim() || DEFAULT_WEIXIN_ILINK_BASE,
		token: config.token,
		signal: abortController.signal,
	})

	await ensureWeixinInterface(char, username, charname)

	const ctx = { ...api, signal: abortController.signal }
	const loopPromise = char.interfaces.weixin.OnceClientReady(ctx, config.config)

	void loopPromise.catch(err => {
		if (!abortController.signal.aborted)
			console.error('[WeChatBot] 轮询结束:', err)
	})

	return {
		/**
		 *
 * @returns {Promise<any>} 操作执行结果。
		 */
		destroy: async () => {
			abortController.abort()
			await loopPromise.catch(() => {})
		},
	}
}

/**
 *
 * @param {any} username 用户名。
 * @returns {any} 返回值。
 */
function getBotCache(username) {
	return loadTempData(username, 'wechatbot_cache')
}

/**
 *
 * @param {any} username 用户名。
 * @returns {any} 返回值。
 */
function getBotsData(username) {
	return loadShellData(username, 'wechatbot', 'bot_configs')
}

/**
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @returns {any} 返回值。
 */
export function getBotConfig(username, botname) {
	return getBotsData(username)[botname] || {}
}

/**
 *
 * @param {any} username 用户名。
 * @param {any} charname 角色名称。
 * @returns {Promise<any>} 机器人配置对象。
 */
export async function getBotConfigTemplate(username, charname) {
	const char = await loadPart(username, 'chars/' + charname)
	await ensureWeixinInterface(char, username, charname)
	return await char.interfaces.weixin?.GetBotConfigTemplate?.() || {}
}

/**
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @param {any} config 配置对象。
 * @returns {any} 配置模板对象。
 */
export function setBotConfig(username, botname, config) {
	getBotsData(username)[botname] = config
	saveShellData(username, 'wechatbot', 'bot_configs')
}

/**
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @returns {any} 操作执行结果。
 */
export function deleteBotConfig(username, botname) {
	delete getBotsData(username)[botname]
	saveShellData(username, 'wechatbot', 'bot_configs')
}

/**
 * Stops the running bot session and removes it from the cache.
 * Does not call EndJob; use stopBot for that.
 * @param {string} username 用户名。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
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
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @returns {Promise<any>} 返回值。
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
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function stopBot(username, botname) {
	await destroyBotSession(username, botname)
	EndJob(username, 'shells/wechatbot', botname)
}

/**
 *
 * @param {any} username 用户名。
 * @param {any} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function pauseBot(username, botname) {
	await destroyBotSession(username, botname)
}

on_shutdown(async () => {
	for (const username of getAllUserNames())
		for (const botname of Object.keys(getBotCache(username)))
			await pauseBot(username, botname).catch(console.error)
})

/**
 *
 * @param {any} username 用户名。
 * @returns {any} 操作执行结果。
 */
export function getRunningBotList(username) {
	return Object.keys(getBotCache(username))
}

/**
 *
 * @param {any} username 用户名。
 * @returns {any} 机器人名称列表。
 */
export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

/**
 * Stops all running bots for a user, logging errors without throwing.
 * @param {string} username 用户名。
 * @param {string} logContext 日志上下文描述（用于错误消息）。
 * @returns {Promise<void>}
 */
async function stopAllRunningBots(username, logContext) {
	for (const botname of getRunningBotList(username))
		try {
			await stopBot(username, botname)
		}
		catch (error) {
			console.error(`WeChat Bot: Error stopping bot ${botname} for ${logContext}:`, error)
		}
}

events.on('BeforeUserDeleted', ({ username }) =>
	stopAllRunningBots(username, `deleted user ${username}`)
)

events.on('BeforeUserRenamed', ({ oldUsername }) =>
	stopAllRunningBots(oldUsername, `old username ${oldUsername}`)
)
