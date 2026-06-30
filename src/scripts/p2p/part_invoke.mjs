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
