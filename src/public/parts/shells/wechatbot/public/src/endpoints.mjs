/**
 * WeChat 机器人 shell 的客户端 API 端点。
 */
import { geti18n } from '../../../../../scripts/i18n.mjs'

const API_BASE = '/api/parts/shells:wechatbot'

/**
 * 发起 fetch 请求并统一处理 HTTP 错误。
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
 * 以 JSON 形式 POST 请求并解析响应。
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
 * 获取所有微信机器人名称列表。
 * @returns {Promise<string[]>} 机器人名称列表。
 */
export async function getBotList() {
	return fetchDataWithHandling(`${API_BASE}/getbotlist`)
}

/**
 * 获取指定机器人的配置。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 机器人配置对象。
 */
export async function getBotConfig(botname) {
	return fetchDataWithHandling(`${API_BASE}/getbotconfig?botname=${encodeURIComponent(botname)}`)
}

/**
 * 保存指定机器人的配置。
 * @param {string} botname 机器人名称。
 * @param {any} config 配置对象。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function setBotConfig(botname, config) {
	return postJson(`${API_BASE}/setbotconfig`, { botname, config })
}

/**
 * 删除指定机器人的配置。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function deleteBotConfig(botname) {
	return postJson(`${API_BASE}/deletebotconfig`, { botname })
}

/**
 * 创建新的机器人配置。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function newBotConfig(botname) {
	return postJson(`${API_BASE}/newbotconfig`, { botname })
}

/**
 * 启动指定微信机器人。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function startBot(botname) {
	return postJson(`${API_BASE}/start`, { botname })
}

/**
 * 停止指定微信机器人。
 * @param {string} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
 */
export async function stopBot(botname) {
	return postJson(`${API_BASE}/stop`, { botname })
}

/**
 * 获取当前正在运行的机器人列表。
 * @returns {Promise<string[]>} 正在运行的机器人名称列表。
 */
export async function getRunningBotList() {
	return fetchDataWithHandling(`${API_BASE}/getrunningbotlist`)
}

/**
 * 获取指定角色的配置模板。
 * @param {string} charname 角色名称。
 * @returns {Promise<any>} 配置模板对象。
 */
export async function getBotConfigTemplate(charname) {
	return fetchDataWithHandling(`${API_BASE}/getbotConfigTemplate?charname=${encodeURIComponent(charname)}`)
}

/**
 * 发起微信二维码登录会话。
 * @param {string} [botname] 目标机器人名称，不传则使用空字符串。
 * @returns {Promise<{ sessionKey: string, qrcodeContent: string }>} 扫码会话初始化结果。
 */
export async function startWechatQrLogin(botname) {
	return postJson(`${API_BASE}/qrcode/start`, { botname: botname || '' })
}

/**
 * 轮询微信二维码登录状态。
 * @param {string} sessionKey 二维码登录会话键。
 * @returns {Promise<any>} 轮询结果。
 */
export async function pollWechatQrLogin(sessionKey) {
	return fetchDataWithHandling(`${API_BASE}/qrcode/poll?sessionKey=${encodeURIComponent(sessionKey)}`)
}
