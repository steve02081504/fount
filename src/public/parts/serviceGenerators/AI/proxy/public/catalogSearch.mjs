/**
 * models.dev 目录的纯逻辑：拍平、匹配搜索、当前配置反查、API 基址转换。
 * 无 DOM / 无全局依赖，供 display.mjs 与单元测试共用。
 */

/** 搜索结果默认上限。 */
export const SEARCH_RESULT_LIMIT = 60

/**
 * 将 models.dev 的 provider API 基址转为 OpenAI 兼容的 chat completions URL。
 * @param {string} providerApi - 厂商 API 基址。
 * @returns {string} chat completions 端点 URL。
 */
export function providerApiToCompletionsUrl(providerApi) {
	if (!providerApi?.trim()) return ''
	try {
		const urlObj = new URL(providerApi)
		const path = urlObj.pathname.replace(/\/$/, '')
		if (path.includes('/chat/completions')) return urlObj.toString()
		if (path.endsWith('/v1')) urlObj.pathname = `${path}/chat/completions`
		else urlObj.pathname = `${path}/v1/chat/completions`
		return urlObj.toString()
	}
	catch {
		return providerApi
	}
}

/**
 * 规范化 API 基址以便比较 config.url 与 provider.api。
 * @param {string} url - 用户或目录中的 URL。
 * @returns {string} 规范化后的 origin + path 小写串。
 */
export function normalizeApiBase(url) {
	if (!url?.trim()) return ''
	try {
		const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
		let path = urlObj.pathname.replace(/\/$/, '')
		path = path.replace(/\/chat\/completions(?:\/.*)?$/, '')
		path = path.replace(/\/models(?:\/.*)?$/, '')
		path = path.replace(/\/v1$/, '')
		return `${urlObj.origin}${path}`
	}
	catch {
		return url.trim()
	}
}

/**
 * 扁平化 models.dev API 响应为候选条目数组。
 * @param {Record<string, object>} apiData - models.dev API JSON。
 * @returns {object[]} 候选条目列表。
 */
export function flattenCatalog(apiData) {
	/** @type {object[]} */
	const entries = []
	for (const provider of Object.values(apiData)) {
		if (!provider?.models) continue
		for (const model of Object.values(provider.models))
			entries.push({
				providerId: provider.id,
				providerName: provider.name || provider.id,
				providerApi: provider.api || '',
				providerDoc: provider.doc || '',
				modelId: model.id,
				modelName: model.name || model.id,
				family: model.family || '',
				context: model.limit?.context,
				outputLimit: model.limit?.output,
				cost: model.cost || {},
				modalities: model.modalities || {},
				reasoning: !!model.reasoning,
				toolCall: !!model.tool_call,
				attachment: !!model.attachment,
				openWeights: !!model.open_weights,
				knowledge: model.knowledge || '',
				releaseDate: model.release_date || model.last_updated || '',
			})

	}
	return entries
}

/**
 * 在目录中查找与当前 config 匹配的条目。
 * @param {object[]} catalog - 扁平化目录。
 * @param {object} config - 当前配置。
 * @returns {object|null} 匹配条目。
 */
export function findCatalogEntry(catalog, config) {
	const modelId = config?.model?.trim()
	const configBase = normalizeApiBase(config?.url)
	if (!modelId || !configBase) return null

	const modelMatches = catalog.filter(entry => entry.modelId === modelId)
	return modelMatches.find(entry => normalizeApiBase(entry.providerApi) === configBase) || null
}

/**
 * 字段 → 相关性权重。含义：该字段命中越"靠前"（整字段相等 > 前缀 > 词首 > 子串）分越高。
 * provider 身份权重最高，使官方源在搜厂商名时压过聚合商的同名模型。
 */
const SEARCH_FIELDS = [
	['providerId', 100],
	['providerName', 100],
	['modelId', 90],
	['modelName', 90],
	['family', 50],
	['providerApi', 30],
	['providerDoc', 30],
]

/** 模态等其他字段的权重。 */
const SEARCH_AUX_WEIGHT = 20

/**
 * 判断小写化的字段值相对搜索词的命中档位。
 * @param {string} rawValue - 字段原值。
 * @param {string} term - 已小写化的搜索词。
 * @returns {number} 0 未命中；1 子串；2 词首；3 前缀；4 完全相等。
 */
function matchTier(rawValue, term) {
	if (!rawValue) return 0
	const value = String(rawValue).toLowerCase()
	if (value === term) return 4
	if (value.startsWith(term)) return 3
	const index = value.indexOf(term)
	if (index < 0) return 0
	const before = value[index - 1]
	return !before || !/[a-z0-9]/.test(before) ? 2 : 1
}

/**
 * 单个搜索词命中的最高加权分；0 表示不命中。
 * @param {object} entry - 目录条目。
 * @param {string} term - 已小写化的搜索词。
 * @returns {number} 加权分。
 */
function bestTermScore(entry, term) {
	let best = 0
	for (const [field, weight] of SEARCH_FIELDS) {
		const tier = matchTier(entry[field], term)
		if (tier) best = Math.max(best, tier * weight)
	}
	for (const modality of [...entry.modalities?.input || [], ...entry.modalities?.output || []]) {
		const tier = matchTier(modality, term)
		if (tier) best = Math.max(best, tier * SEARCH_AUX_WEIGHT)
	}
	return best
}

/**
 * 按关键词搜索目录，按相关性降序返回。所有词都需命中（AND）；厂商身份命中优先于模型名命中。
 * @param {object[]} catalog - 扁平化目录。
 * @param {string} query - 搜索词。
 * @param {number} [limit] - 结果上限。
 * @returns {object[]} 匹配的候选条目。
 */
export function searchCatalog(catalog, query, limit = SEARCH_RESULT_LIMIT) {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return []

	const scored = []
	for (const entry of catalog) {
		let score = 0
		let matchedAll = true
		for (const term of terms) {
			const termScore = bestTermScore(entry, term)
			if (!termScore) {
				matchedAll = false
				break
			}
			score += termScore
		}
		if (matchedAll) scored.push({ entry, score })
	}

	scored.sort((a, b) => b.score - a.score)
	return scored.slice(0, limit).map(item => item.entry)
}
