/**
 * Telegram 机器人 shell 的客户端 API 端点。
 */
import { geti18n } from '../../../../scripts/i18n.mjs'

/**
 * 使用错误处理获取数据。
 * @param {string} url - URL。
 * @param {object} [options={}] - 选项。
 * @returns {Promise<any>} - 响应数据。
 */
async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `${geti18n('telegram_bots.alerts.httpError')}! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 获取机器人列表。
 * @returns {Promise<any>} - 机器人列表。
 */
export async function getBotList() {
	return fetchDataWithHandling('/api/shells/telegrambot/getbotlist')
}

/**
 * 获取机器人配置。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<any>} - 机器人配置。
 */
export async function getBotConfig(botname) {
	return fetchDataWithHandling(`/api/shells/telegrambot/getbotconfig?botname=${encodeURIComponent(botname)}`)
}

/**
 * 设置机器人配置。
 * @param {string} botname - 机器人名称。
 * @param {object} config - 配置。
 * @returns {Promise<any>} - 响应数据。
 */
export async function setBotConfig(botname, config) {
	return fetchDataWithHandling('/api/shells/telegrambot/setbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname, config }),
	})
}

/**
 * 删除机器人配置。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function deleteBotConfig(botname) {
	return fetchDataWithHandling('/api/shells/telegrambot/deletebotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

/**
 * 新建机器人配置。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function newBotConfig(botname) {
	return fetchDataWithHandling('/api/shells/telegrambot/newbotconfig', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

/**
 * 启动机器人。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function startBot(botname) {
	return fetchDataWithHandling('/api/shells/telegrambot/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

/**
 * 停止机器人。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<any>} - 响应数据。
 */
export async function stopBot(botname) {
	return fetchDataWithHandling('/api/shells/telegrambot/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ botname }),
	})
}

/**
 * 获取正在运行的机器人列表。
 * @returns {Promise<any>} - 正在运行的机器人列表。
 */
export async function getRunningBotList() {
	return fetchDataWithHandling('/api/shells/telegrambot/getrunningbotlist')
}

/**
 * 获取机器人配置模板。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 机器人配置模板。
 */
export async function getBotConfigTemplate(charname) {
	return fetchDataWithHandling(`/api/shells/telegrambot/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`)
}
