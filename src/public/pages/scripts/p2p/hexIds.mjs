// TODO: fount-p2p 发布后改为 esm.sh 导入包内容，删除本地副本
/** 64 位小写十六进制（DAG 事件 id、公钥哈希等）。 */
export const HEX_ID_64 = /^[\da-f]{64}$/u

/** 签名 hex（128 字符）。 */
export const SIGNATURE_HEX_128 = /^[\da-f]{128}$/u

/** `blob:<64hex>` 存储定位符。 */
export const BLOB_STORAGE_LOCATOR_RE = /^blob:([\da-f]{64})$/u

/** `local:…/chunks/<64hex>.bin` 群分块路径。 */
export const LOCAL_CHUNK_FILE_RE = /^local:[^/]+\/chunks\/([\da-f]{64})\.bin$/u

/**
 * @param {unknown} value 原始字符串
 * @returns {string} trim + 去 0x + 小写
 */
export function normalizeHex64(value) {
	return String(value ?? '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为 64 位 hex
 */
export function isHex64(value) {
	return HEX_ID_64.test(normalizeHex64(value))
}

/**
 * 64 位 hex eventId 字典序比较（固定宽度 ASCII，不用 localeCompare）。
 * @param {unknown} a 左操作数
 * @param {unknown} b 右操作数
 * @returns {number} 排序比较结果
 */
export function compareHex64Asc(a, b) {
	const sa = normalizeHex64(a)
	const sb = normalizeHex64(b)
	return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * 外部入站专用：规范化并断言 64 位 hex。
 * @param {unknown} value 原始值
 * @param {string} [label='hex64'] 字段名（错误信息）
 * @returns {string} 小写 64 位 hex
 */
export function assertHex64(value, label = 'hex64') {
	const normalized = normalizeHex64(value)
	if (!HEX_ID_64.test(normalized))
		throw new Error(`${label} must be 64 hex characters`)
	return normalized
}

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为 128 位签名 hex
 */
export function isSignatureHex128(value) {
	return SIGNATURE_HEX_128.test(String(value ?? '').trim())
}

/**
 * 外部入站专用：断言 128 位签名 hex。
 * @param {unknown} value 原始值
 * @param {string} [label='signature'] 字段名
 * @returns {string} 签名 hex
 */
export function assertSignatureHex128(value, label = 'signature') {
	const normalized = String(value ?? '').trim().toLowerCase()
	if (!SIGNATURE_HEX_128.test(normalized))
		throw new Error(`${label} must be 128 hex characters`)
	return normalized
}
