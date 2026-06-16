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
		return `[${value.map(item => item === undefined ? 'null' : canonicalStringify(item)).join(',')}]`
	if (typeof value === 'object') {
		// 跳过值为 undefined 的键，与 JSON.stringify 语义一致：否则 canonical 串会写出字面量 `undefined`，
		// 而事件经 JSON wire/落盘往返后这些键会消失，导致 computeEventId 两端不一致（id_mismatch）。
		const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
		return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`
	}
	throw new TypeError(`Unsupported type: ${typeof value}`)
}
