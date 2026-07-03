/**
 * live HTTP 探针底层 fetch 封装（单节点与联邦共用）。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/require-param-type -- live probe harness */

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
 * @returns {string}
 */
export function buildApiUri(base, key, path) {
	const root = base.trim().replace(/\/+$/, '')
	const separator = path.includes('?') ? '&' : '?'
	return `${root}${path}${separator}fount-apikey=${encodeURIComponent(key.trim())}`
}

/**
 * @param {unknown} raw 响应体
 * @returns {unknown}
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
 * @returns {Promise<LiveHttpResponse>}
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
 * @returns {Promise<LiveHttpResponse>}
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
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** 1×1 PNG（与 federation/common.mjs 一致）。 */
export const TEST_PNG_BYTES = Uint8Array.from(atob(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
), c => c.charCodeAt(0))

/** @param {string} [dataUrlPrefix='data:image/png;base64,'] */
export function testPngDataUrl(dataUrlPrefix = 'data:image/png;base64,') {
	return `${dataUrlPrefix}${btoa(String.fromCharCode(...TEST_PNG_BYTES))}`
}
