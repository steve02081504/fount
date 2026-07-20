/**
 * 【文件】lib/jsonBoundary.mjs
 * 【职责】RPC/联邦/char_rpc 边界的 JSON 可序列化校验与归一化，防止跨节点（WS↔P2P）静默丢字段。
 * 【原理】normalizeJsonBoundaryValue 经 JSON.stringify/parse 往返；失败抛带 code 的错误（RPC_INVALID_ARGUMENT 等）。room char_rpc 与 remoteProxy 入参/出参均经此处理。
 * 【数据结构】错误对象含 code、boundary 标签字符串。
 * 【关联】federation/charRpc、remoteProxy、remoteWorldProxy、p2p/dag/strip_extensions.mjs。
 */
/**
 * 检查并归一化 JSON 边界值：不可序列化时抛错，避免跨节点静默丢字段。
 * @param {unknown} value 待校验值
 * @param {string} boundary 语义边界标签（用于错误信息）
 * @returns {any} 经过 JSON 语义归一化（stringify/parse）的值
 */
export function normalizeJsonBoundaryValue(value, boundary) {
	/** @type {WeakSet<object>} */
	const seen = new WeakSet()
	const pathStack = ['<root>']
	const encoded = JSON.stringify(value, function replacer(key, raw) {
		if (key) pathStack.push(key)
		try {
			if (raw === undefined)
				throw jsonBoundaryError(boundary, `undefined cannot cross JSON boundary (path: ${pathStack.join('.')})`)
			if (typeof raw === 'function')
				throw jsonBoundaryError(boundary, `function cannot be transmitted by value (path: ${pathStack.join('.')})`)
			if (typeof raw === 'symbol')
				throw jsonBoundaryError(boundary, `symbol cannot cross JSON boundary (path: ${pathStack.join('.')})`)
			if (typeof raw === 'bigint')
				throw jsonBoundaryError(boundary, `bigint cannot cross JSON boundary (path: ${pathStack.join('.')})`)
			if (raw && typeof raw === 'object') {
				if (seen.has(raw))
					throw jsonBoundaryError(boundary, `circular reference detected (path: ${pathStack.join('.')})`)
				seen.add(raw)
			}
			return raw
		}
		finally {
			if (key) pathStack.pop()
		}
	})
	if (encoded === undefined)
		throw jsonBoundaryError(boundary, 'root value is not JSON-serializable')
	return JSON.parse(encoded)
}

/**
 * @param {string} boundary 语义边界标签
 * @param {string} reason 失败原因
 * @returns {Error} 带 RPC/JSON 错误 code 的错误
 */
function jsonBoundaryError(boundary, reason) {
	const tag = classifyRpcBoundaryTag(boundary)
	const code = tag === 'args'
		? 'RPC_INVALID_ARGUMENT'
		: tag === 'result'
			? 'RPC_INVALID_RESULT'
			: 'JSON_SERIALIZATION_ERROR'
	const err = new Error(`${code}: ${reason} (${boundary})`)
	err.code = code
	err.rpcBoundaryTag = tag
	return err
}

/**
 * @param {string} boundary 边界标签
 * @returns {'args' | 'result' | 'json'} RPC 边界分类
 */
function classifyRpcBoundaryTag(boundary) {
	if (!boundary) return 'json'
	if (boundary.includes('.args:') || boundary.includes('rpc.args:')) return 'args'
	if (boundary.includes('.result:') || boundary.includes('rpc.result:')) return 'result'
	return 'json'
}
