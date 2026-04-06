/**
 * WeChat 机器人 shell 的客户端 API 端点。
 */
import { geti18n } from '../../../../../scripts/i18n.mjs'

const API_BASE = '/api/parts/shells:wechatbot'

/**
 * @param {string} url 请求地址。
 * @param {object} [options={}] fetch 请求选项。
 * @returns {Promise<any>} 解析后的 JSON 响应。
 */
async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `${geti18n('wechat_bots.alerts.httpError')}! status: ${response.status}`)
	}
	return response.json()
}

/**
 * @param {string} url 请求地址。
 * @param {object} data 请求体对象（将被序列化为 JSON）。
 * @returns {Promise<any>} 解析后的 JSON 响应。
 */
function postJson(url, data) {
	return fetchDataWithHandling(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
}

/**
 * @returns {Promise<string[]>} 机器人名称列表。
 */
export async function getBotList() {
	return fetchDataWithHandling(`${API_BASE}/getbotlist`)
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 机器人配置对象。
 */
export async function getBotConfig(botname) {
	return fetchDataWithHandling(`${API_BASE}/getbotconfig?botname=${encodeURIComponent(botname)}`)
}

/**
 * @param {string} botname 机器人名称。
 * @param {any} config 配置对象。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function setBotConfig(botname, config) {
	return postJson(`${API_BASE}/setbotconfig`, { botname, config })
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function deleteBotConfig(botname) {
	return postJson(`${API_BASE}/deletebotconfig`, { botname })
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function newBotConfig(botname) {
	return postJson(`${API_BASE}/newbotconfig`, { botname })
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function startBot(botname) {
	return postJson(`${API_BASE}/start`, { botname })
}

/**
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function stopBot(botname) {
	return postJson(`${API_BASE}/stop`, { botname })
}

/**
 * @returns {Promise<string[]>} 正在运行的机器人名称列表。
 */
export async function getRunningBotList() {
	return fetchDataWithHandling(`${API_BASE}/getrunningbotlist`)
}

/**
 * @param {string} charname 角色名称。
 * @returns {Promise<any>} 配置模板对象。
 */
export async function getBotConfigTemplate(charname) {
	return fetchDataWithHandling(`${API_BASE}/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`)
}

/**
 * @param {string} [botname] 目标机器人名称，不传则使用空字符串。
 * @returns {Promise<{ sessionKey: string, qrcodeContent: string }>} 扫码会话初始化结果。
 */
export async function startWechatQrLogin(botname) {
	return postJson(`${API_BASE}/qrcode/start`, { botname: botname || '' })
}

/**
 * @param {string} sessionKey 二维码登录会话键。
 * @returns {Promise<any>} 轮询结果。
 */
export async function pollWechatQrLogin(sessionKey) {
	return fetchDataWithHandling(`${API_BASE}/qrcode/poll?sessionKey=${encodeURIComponent(sessionKey)}`)
}
