/**
 * 统一 manifest / suite / subtest 选择器解析：
 * `manifest`、`manifest:suite`、`manifest:suite:subtest`、以及 `/` 变体。
 */

/**
 * @typedef {object} ResolvedSelector
 * @property {string} manifestId
 * @property {string[]} suiteSelectors suite 名（无第三级时）
 * @property {Record<string, string[]>} subtestSelectors suite 名 → 子测试名列表（空数组表示该 suite 全部子测试未限定）
 */

/**
 * 解析 suite/subtest 片段列表（`suite` 或 `suite:subtest`）。
 * @param {string[]} parts 逗号/空白切分后的片段
 * @returns {{ suiteSelectors: string[], subtestSelectors: Record<string, string[]> }} 解析结果
 */
function parseSuiteSubtestParts(parts) {
	/** @type {string[]} */
	const suiteSelectors = []
	/** @type {Record<string, string[]>} */
	const subtestSelectors = {}
	for (const part of parts) {
		const colon = part.indexOf(':')
		if (colon < 0) {
			suiteSelectors.push(part)
			continue
		}
		const suite = part.slice(0, colon).trim()
		const subtest = part.slice(colon + 1).trim()
		if (!suite) continue
		if (!suiteSelectors.includes(suite))
			suiteSelectors.push(suite)
		if (subtest) {
			const list = subtestSelectors[suite] ?? []
			if (!list.includes(subtest)) list.push(subtest)
			subtestSelectors[suite] = list
		}
	}
	return { suiteSelectors, subtestSelectors }
}

/**
 * @param {string} token 原始 token
 * @param {string[]} knownManifestIds 已知 manifest id（越长越优先匹配前缀）
 * @returns {ResolvedSelector | null} 解析结果；无法识别为 null
 */
export function resolveSelector(token, knownManifestIds) {
	const trimmed = token.trim()
	if (!trimmed) return null

	if (trimmed.includes(':')) {
		const colon = trimmed.indexOf(':')
		const rest = trimmed.slice(colon + 1).split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
		const { suiteSelectors, subtestSelectors } = parseSuiteSubtestParts(rest)
		return {
			manifestId: trimmed.slice(0, colon),
			suiteSelectors,
			subtestSelectors,
		}
	}

	if (knownManifestIds.includes(trimmed))
		return { manifestId: trimmed, suiteSelectors: [], subtestSelectors: {} }

	const sorted = [...knownManifestIds].sort((a, b) => b.length - a.length)
	for (const manifestId of sorted) {
		const prefix = `${manifestId}/`
		if (!trimmed.startsWith(prefix)) continue
		const suitePart = trimmed.slice(prefix.length)
		if (!suitePart) return { manifestId, suiteSelectors: [], subtestSelectors: {} }
		/** @type {string[]} */
		const slashParts = []
		for (const chunk of suitePart.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)) {
			const slash = chunk.indexOf('/')
			if (slash < 0) slashParts.push(chunk)
			else slashParts.push(`${chunk.slice(0, slash)}:${chunk.slice(slash + 1)}`)
		}
		const { suiteSelectors, subtestSelectors } = parseSuiteSubtestParts(slashParts)
		return { manifestId, suiteSelectors, subtestSelectors }
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
