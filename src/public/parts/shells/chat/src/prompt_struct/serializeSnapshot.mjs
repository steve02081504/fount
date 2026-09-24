/**
 * 【文件】serializeSnapshot.mjs — prompt 快照结构的确定性纯文本序列化
 * 【职责】把 AI 源 `BuildPrompt` 产出的 JSON 结构（array / object / string / number / Buffer）无深度上限地序列化为 tab 缩进、`\n` 换行的纯文本，供 prompt 缓存做前缀对比。
 * 【原理】对象按插入顺序输出；buffer 按每 50KB 分块各取 2 字节（16 位 FNV-1a 低 16 位）拼成变长 hash，既不把二进制塞进快照又保持内容敏感。
 * 【关联】snapshot.mjs、decl/AIsource.ts 的 `BuildPrompt`。
 */

/** 每个 buffer hash 分块的字节数（50KB）。 */
export const BUFFER_HASH_CHUNK_BYTES = 50 * 1024

/**
 * 值是否为二进制字节序列。
 * @param {unknown} value 值
 * @returns {boolean} 是否按 buffer 处理
 */
function isBytes(value) {
	return value instanceof Uint8Array || value instanceof ArrayBuffer
}

/**
 * 计算 buffer 的变长 hash：每 50KB 产出 2 字节（4 个十六进制字符），长度随字节数增长。
 * @param {Uint8Array | ArrayBuffer} value 字节序列
 * @returns {string} 形如 `<buffer 1234B a1b2c3d4>` 的可读标记
 */
export function hashBytes(value) {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
	let hex = ''
	for (let offset = 0; offset < bytes.length; offset += BUFFER_HASH_CHUNK_BYTES) {
		const end = Math.min(offset + BUFFER_HASH_CHUNK_BYTES, bytes.length)
		let hash = 0x811c9dc5
		for (let index = offset; index < end; index++) {
			hash ^= bytes[index]
			hash = Math.imul(hash, 0x01000193) >>> 0
		}
		hex += (hash & 0xffff).toString(16).padStart(4, '0')
	}
	return `<buffer ${bytes.byteLength}B ${hex}>`
}

/**
 * 把 JSON 结构递归序列化为纯文本（无限深度，tab 缩进，`\n` 换行）。
 * @param {unknown} value 值
 * @param {number} [depth] 当前缩进层级
 * @returns {string} 序列化文本
 */
export function serializeSnapshotValue(value, depth = 0) {
	const pad = '\t'.repeat(depth)
	if (value === null) return 'null'
	const type = typeof value
	if (type === 'string') return JSON.stringify(value)
	if (type === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value))
	if (type === 'boolean') return value ? 'true' : 'false'
	if (type === 'bigint') return value.toString()
	if (isBytes(value)) return JSON.stringify(hashBytes(value))
	if (Array.isArray(value)) {
		if (!value.length) return '[]'
		return `[\n${value.map(item => `${pad}\t${serializeSnapshotValue(item, depth + 1)}`).join(',\n')}\n${pad}]`
	}
	if (type === 'object') {
		const keys = Object.keys(value)
		if (!keys.length) return '{}'
		return `{\n${keys.map(key => `${pad}\t${JSON.stringify(key)}: ${serializeSnapshotValue(value[key], depth + 1)}`).join(',\n')}\n${pad}}`
	}
	return JSON.stringify(String(value))
}
