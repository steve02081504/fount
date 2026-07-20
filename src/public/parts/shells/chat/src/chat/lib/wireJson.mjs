/**
 * P2P / 群 WS JSON 边界：单次 stringify/parse，本地 RPC 不经过此模块。
 */

/**
 * @param {string} boundary 错误标签
 * @param {string} reason 原因
 * @param {'args' | 'result'} tag 参数侧或结果侧
 * @returns {Error} 带 `code` 的 RPC 错误
 */
function wireJsonError(boundary, reason, tag) {
	const code = tag === 'args' ? 'RPC_INVALID_ARGUMENT' : 'RPC_INVALID_RESULT'
	const err = new Error(`${code}: ${reason} (${boundary})`)
	err.code = code
	return err
}

/**
 * @param {string} boundary 语义标签
 * @returns {'args' | 'result'} 由 boundary 字符串推断的侧别
 */
function classifyBoundaryTag(boundary) {
	if (boundary.includes('.args:') || boundary.includes('rpc.args:')) return 'args'
	return 'result'
}

/**
 * @param {unknown} value 待编码值
 * @param {string} boundary 语义标签（错误信息）
 * @returns {any} JSON 语义副本
 */
export function encodeWireJson(value, boundary) {
	try {
		const encoded = JSON.stringify(value)
		if (encoded === undefined)
			throw wireJsonError(boundary, 'root value is not JSON-serializable', classifyBoundaryTag(boundary))
		return JSON.parse(encoded)
	}
	catch (err) {
		if (err?.code) throw err
		throw wireJsonError(boundary, err?.message || 'serialization failed', classifyBoundaryTag(boundary))
	}
}
