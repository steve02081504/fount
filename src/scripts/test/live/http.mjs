/**
 * live HTTP 探针底层 fetch 封装（单节点与联邦共用）。
 */

import { ms } from '../../ms.mjs'

/**
 * @typedef {{ base: string, key: string, name?: string, dataPath?: string, index?: number }} LiveNodeHandle
 */

/**
 * @typedef {{ status: number, json: unknown, raw: string }} LiveHttpResponse
 */

/**
 * 构造带 API key 的 URL。
 * @param {string} base 节点根 URL
 * @param {string} key API key
 * @param {string} path 路径（可含 query）
 * @returns {string} 带 API key 的完整 URL
 */
export function buildApiUri(base, key, path) {
	const root = base.trim().replace(/\/+$/, '')
	const separator = path.includes('?') ? '&' : '?'
	return `${root}${path}${separator}fount-apikey=${encodeURIComponent(key.trim())}`
}

/**
 * @param {unknown} raw 响应体文本
 * @returns {unknown} 解析后的 JSON 或原文
 */
function parseJsonBody(raw) {
	if (!raw) return null
	try {
		return JSON.parse(raw)
	}
	catch {
		return raw
	}
}

/**
 * 发起 HTTP 请求（不抛 HTTP 错误，由调用方检查 status）。
 * @param {LiveNodeHandle | { base: string, key: string }} node 节点或 base/key 对
 * @param {string} method HTTP 方法
 * @param {string} path 绝对或 shell 相对路径
 * @param {unknown} [body] JSON 请求体
 * @param {object} [options] 选项
 * @param {number} [options.timeoutSec=180] 超时秒
 * @param {string} [options.shell] shell 名；设置则 path 为 shell 相对路径
 * @returns {Promise<LiveHttpResponse>} HTTP 响应（不抛状态错误）
 */
export async function invokeRequest(node, method, path, body, options = {}) {
	const { timeoutSec = 180, shell } = options
	const fullPath = shell
		? `/api/parts/shells:${shell}${path}`
		: path.startsWith('/') ? path : `/${path}`
	const uri = buildApiUri(node.base, node.key, fullPath)
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)
	try {
		const response = await fetch(uri, {
			method,
			signal: controller.signal,
			headers: body != null ? { 'content-type': 'application/json' } : undefined,
			body: body != null ? JSON.stringify(body) : undefined,
		})
		const raw = await response.text()
		return { status: response.status, json: parseJsonBody(raw), raw }
	}
	finally {
		clearTimeout(timer)
	}
}

/**
 * multipart/form-data 请求。
 * @param {LiveNodeHandle} node 节点
 * @param {string} shell shell 名
 * @param {string} method HTTP 方法
 * @param {string} path shell 相对路径
 * @param {Record<string, string | number | boolean>} fields 表单字段
 * @param {string} fileField 文件字段名
 * @param {string} fileName 文件名
 * @param {Uint8Array} fileBytes 文件内容
 * @param {string} [contentType='image/png'] MIME
 * @returns {Promise<LiveHttpResponse>} multipart HTTP 响应
 */
export async function invokeMultipart(node, shell, method, path, fields, fileField, fileName, fileBytes, contentType = 'image/png') {
	const uri = buildApiUri(node.base, node.key, `/api/parts/shells:${shell}${path}`)
	const form = new FormData()
	for (const [key, value] of Object.entries(fields))
		form.append(key, String(value))
	form.append(fileField, new Blob([fileBytes], { type: contentType }), fileName)
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), ms('2m'))
	try {
		const response = await fetch(uri, { method, body: form, signal: controller.signal })
		const raw = await response.text()
		return { status: response.status, json: parseJsonBody(raw), raw }
	}
	finally {
		clearTimeout(timer)
	}
}

/**
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 无
 */
export function sleep(ms) {
	return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * 判断 HTTP 状态是否成功（默认 200/201）。
 * @param {number} status HTTP 状态码
 * @param {number[]} [allowed=[200, 201]] 允许的状态码
 * @returns {boolean} 是否在允许范围内
 */
export function okStatus(status, allowed = [200, 201]) {
	return allowed.includes(status)
}

/**
 * live/fed 软轮询：单位为秒；超时返回末次结果（常为 false），不抛错。
 * 集成测试要硬失败请用 `waitUntil`（毫秒、超时抛错）。
 * @param {() => unknown | Promise<unknown>} predicate 探测函数
 * @param {number} [timeoutSec=30] 超时秒
 * @param {number} [intervalSec=0.4] 间隔秒
 * @returns {Promise<unknown>} 首次真值，或超时后的末次结果
 */
export async function pollUntil(predicate, timeoutSec = 30, intervalSec = 0.4) {
	const deadline = Date.now() + timeoutSec * 1000
	let last = false
	while (Date.now() < deadline) {
		last = await predicate()
		if (last) return last
		await sleep(intervalSec * 1000)
	}
	return last
}

/**
 * 集成测试硬轮询：单位为毫秒；超时抛 `waitUntil timeout`。
 * live/fed 软等待请用 `pollUntil`（秒、超时返回 false）。
 * @param {() => unknown | Promise<unknown>} predicate 条件
 * @param {number} [timeoutMs=10000] 超时毫秒
 * @param {number} [intervalMs=100] 间隔毫秒
 * @returns {Promise<void>}
 */
export async function waitUntil(predicate, timeoutMs = 10000, intervalMs = 100) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await sleep(intervalMs)
	}
	throw new Error('waitUntil timeout')
}

/** 1×1 PNG（与 federation/common.mjs 一致）。 */
export const TEST_PNG_BYTES = Uint8Array.from(atob(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
), c => c.charCodeAt(0))

/**
 * @param {string} [dataUrlPrefix='data:image/png;base64,'] data URL 前缀
 * @returns {string} 测试 PNG 的 data URL
 */
export function testPngDataUrl(dataUrlPrefix = 'data:image/png;base64,') {
	return `${dataUrlPrefix}${btoa(String.fromCharCode(...TEST_PNG_BYTES))}`
}
