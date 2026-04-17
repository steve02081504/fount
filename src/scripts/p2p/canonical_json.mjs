/**
 * 确定性 JSON 序列化（键排序），用于 event id 与验签负载
 *
 * @param {unknown} value 任意可 JSON 化的结构（禁止 BigInt）
 * @returns {string} 键已排序的紧凑 JSON 文本
 */
export function canonicalStringify(value) {
	if (value === null || value === undefined) return JSON.stringify(value)
	if (typeof value === 'bigint') throw new TypeError('BigInt not allowed in canonical JSON')
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
		return JSON.stringify(value)
	if (Array.isArray(value))
		return `[${value.map(v => canonicalStringify(v)).join(',')}]`
	if (typeof value === 'object') {
		const keys = Object.keys(value).sort()
		return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`
	}
	throw new TypeError(`Unsupported type: ${typeof value}`)
}
