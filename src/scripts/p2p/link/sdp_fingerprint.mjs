/**
 * 将 DTLS fingerprint 规范化为小写 `aa:bb:...` 格式。
 * @param {unknown} value 原始 fingerprint 字符串
 * @returns {string | null} 规范化后的 fingerprint，无效时返回 null
 */
export function normalizeDtlsFingerprint(value) {
	const text = String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^sha-256\s+/u, '')
	if (!text) return null
	const compact = text.replace(/\s+/gu, '')
	if (!/^([\da-f]{2}:){31}[\da-f]{2}$/u.test(compact)) return null
	return compact
}

/**
 * 从 SDP 文本中提取 SHA-256 DTLS fingerprint。
 * @param {string} sdp SDP 描述字符串
 * @returns {string | null} 规范化 fingerprint，未找到时返回 null
 */
export function extractDtlsFingerprint(sdp) {
	const line = String(sdp || '').match(/^a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)$/mu)?.[1]
	return normalizeDtlsFingerprint(line)
}
