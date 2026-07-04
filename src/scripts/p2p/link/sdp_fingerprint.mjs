/**
 * @param {unknown} value
 * @returns {string | null}
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
 * @param {string} sdp
 * @returns {string | null}
 */
export function extractDtlsFingerprint(sdp) {
	const line = String(sdp || '').match(/^a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)$/mu)?.[1]
	return normalizeDtlsFingerprint(line)
}
