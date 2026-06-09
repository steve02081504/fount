import { isPlainObject } from './wire_ingress.mjs'

const PARTPATH_RE = /^[\w-]+(?:\/[\w-]+)*$/

/** @typedef {{ result?: unknown, error?: { message: string, code?: string } }} PartInvokeResponse */

/**
 * @param {unknown} value 候选响应
 * @returns {boolean} 是否为 part_invoke 响应体
 */
export function isPartInvokeResponse(value) {
	return isPlainObject(value) && ('result' in value || 'error' in value)
}

/**
 * @param {PartInvokeResponse | null | undefined} response RPC 响应
 * @returns {unknown | null} 成功 `result`；失败或空为 null
 */
export function unwrapPartInvokeResult(response) {
	if (!response || response.error) return null
	return response.result ?? null
}

/**
 * @param {unknown} value partpath 字符串
 * @returns {string | null} 规范化 partpath
 */
export function normalizePartpath(value) {
	const path = String(value || '').trim().replace(/^\/+|\/+$/g, '')
	return PARTPATH_RE.test(path) ? path : null
}

/**
 * 经 loadPart(username, partpath) 调用目标 Part 的 P2PInvokeHandler（对齐 IPC invokepart）。
 * @param {string} username replica 登录名
 * @param {string} partpath 如 shells/social
 * @param {object} data 入站载荷
 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站元数据
 * @returns {Promise<PartInvokeResponse | null>} 无 handler 或非法载荷时为 null
 */
export async function invokePartUserRoom(username, partpath, data, ingress = {}) {
	const path = normalizePartpath(partpath)
	if (!path || !isPlainObject(data)) return null
	const { loadPart, hasPartMain } = await import('../../server/parts_loader.mjs')
	if (!hasPartMain(username, path)) return null
	let part
	try {
		part = await loadPart(username, path)
	}
	catch (err) {
		console.error('p2p: part_invoke loadPart failed', { partpath: path, err })
		return { error: { message: 'load_failed', code: 'LOAD_FAILED' } }
	}
	const handler = part?.interfaces?.invokes?.P2PInvokeHandler
	if (!handler) return null
	try {
		const response = await handler(username, data, ingress)
		if (response == null) return null
		if (!isPartInvokeResponse(response))
			throw new Error('P2PInvokeHandler must return { result } or { error }')
		return response
	}
	catch (err) {
		console.error('p2p: P2PInvokeHandler failed', { partpath: path, err })
		return {
			error: {
				message: err instanceof Error ? err.message : 'handler_failed',
				code: 'HANDLER_FAILED',
			},
		}
	}
}
