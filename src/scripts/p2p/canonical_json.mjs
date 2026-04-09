/**
 * 确定性 JSON 序列化（键排序），用于 event id 与验签负载
 * @param {unknown} value
 * @returns {string}
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
