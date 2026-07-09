/**
 * 统一 manifest / suite 选择器解析：`manifest`、`manifest:suite`、`manifest/suite`。
 */

/**
 * @param {string} token 原始 token
 * @param {string[]} knownManifestIds 已知 manifest id（越长越优先匹配前缀）
 * @returns {{ manifestId: string, suiteSelectors: string[] } | null} 解析结果；无法识别为 null
 */
export function resolveSelector(token, knownManifestIds) {
	const trimmed = token.trim()
	if (!trimmed) return null

	if (trimmed.includes(':')) {
		const colon = trimmed.indexOf(':')
		return {
			manifestId: trimmed.slice(0, colon),
			suiteSelectors: trimmed.slice(colon + 1).split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
		}
	}

	if (knownManifestIds.includes(trimmed))
		return { manifestId: trimmed, suiteSelectors: [] }

	const sorted = [...knownManifestIds].sort((a, b) => b.length - a.length)
	for (const manifestId of sorted) {
		const prefix = `${manifestId}/`
		if (!trimmed.startsWith(prefix)) continue
		const suitePart = trimmed.slice(prefix.length)
		if (!suitePart) return { manifestId, suiteSelectors: [] }
		return {
			manifestId,
			suiteSelectors: suitePart.split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
		}
	}

	return null
}

/**
 * 解析 dependsOn 条目。
 * @param {string} raw 原始 dependsOn
 * @param {string} ownerManifestId 所属 manifest
 * @param {string[]} knownManifestIds 已知 manifest id
 * @returns {{ manifestSelectors: string[], suiteSelectors: string[] }} 解析结果
 */
export function parseDependsOnEntry(raw, ownerManifestId, knownManifestIds) {
	const resolved = resolveSelector(raw, knownManifestIds)
	if (!resolved)
		return { manifestSelectors: [ownerManifestId], suiteSelectors: [raw.trim()] }
	return {
		manifestSelectors: [resolved.manifestId],
		suiteSelectors: resolved.suiteSelectors.length ? resolved.suiteSelectors : [],
	}
}

/**
 * CLI positional 是否像 suite 续接 token（无 manifest 前缀的裸 suite 名）。
 * @param {string} token token
 * @param {string[]} knownManifestIds 已知 manifest id
 * @returns {boolean} 是否为续接裸 suite 名（非 manifest 前缀）
 */
export function isBareSuiteContinuation(token, knownManifestIds) {
	if (!token || token.includes(':') || token.startsWith('--')) return false
	return !knownManifestIds.includes(token) && !resolveSelector(token, knownManifestIds)
}
