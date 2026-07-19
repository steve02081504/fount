/* global cache */
const MODELS_DEV_API = 'https://models.dev/api.json'
const SEARCH_RESULT_LIMIT = 60
const SEARCH_DEBOUNCE_MS = 150

/**
 * 将 models.dev 的 provider API 基址转为 OpenAI 兼容的 chat completions URL。
 * @param {string} providerApi - 厂商 API 基址。
 * @returns {string} chat completions 端点 URL。
 */
function providerApiToCompletionsUrl(providerApi) {
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
function normalizeApiBase(url) {
	if (!url?.trim()) return ''
	try {
		const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
		let path = urlObj.pathname.replace(/\/$/, '')
		path = path.replace(/\/chat\/completions(?:\/.*)?$/, '')
		path = path.replace(/\/models(?:\/.*)?$/, '')
		return `${urlObj.origin}${path}`.toLowerCase()
	}
	catch {
		return url.trim().toLowerCase()
	}
}

/**
 * 扁平化 models.dev API 响应为候选条目数组。
 * @param {Record<string, object>} apiData - models.dev API JSON。
 * @returns {object[]} 候选条目列表。
 */
function flattenCatalog(apiData) {
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
function findCatalogEntry(catalog, config) {
	const modelId = config?.model?.trim()
	const configBase = normalizeApiBase(config?.url)
	if (!modelId || !configBase) return null

	const modelMatches = catalog.filter(entry => entry.modelId === modelId)
	return modelMatches.find(entry => normalizeApiBase(entry.providerApi) === configBase) || null
}

/**
 * 按关键词搜索目录。
 * @param {object[]} catalog - 扁平化目录。
 * @param {string} query - 搜索词。
 * @param {number} [limit] - 结果上限。
 * @returns {object[]} 匹配的候选条目。
 */
function searchCatalog(catalog, query, limit = SEARCH_RESULT_LIMIT) {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return []

	return catalog.filter(entry => {
		const haystack = [
			entry.modelName,
			entry.modelId,
			entry.providerName,
			entry.providerId,
			entry.family,
			...entry.modalities?.input || [],
			...entry.modalities?.output || [],
		].filter(Boolean).join(' ').toLowerCase()
		return terms.every(term => haystack.includes(term))
	}).slice(0, limit)
}

/**
 * 格式化 token 价格显示。
 * @param {number|string|undefined} value - 价格数值。
 * @returns {string} 展示文本。
 */
function formatTokenPrice(value) {
	if (value == null || value === '') return '—'
	const number = Number(value)
	if (Number.isNaN(number)) return String(value)
	return `$${number}`
}

/**
 * 加载 models.dev 目录(会话内复用 cache.catalog promise)。
 * @returns {Promise<object[]>} 扁平化目录。
 */
function loadModelsCatalog() {
	cache.catalog ??= fetch(MODELS_DEV_API)
		.then(response => {
			if (!response.ok)
				throw new Error(`${response.status} ${response.statusText}`)
			return response.json()
		})
		.then(flattenCatalog)
		.catch(error => {
			delete cache.catalog
			throw error
		})
	return cache.catalog
}

/**
 * 将选中条目写回 JSON 配置。
 * @param {object} editors - 编辑器实例集合。
 * @param {object} entry - 目录条目。
 * @returns {void}
 */
function applyConfigFromEntry(editors, entry) {
	if (!editors?.json) return
	let config
	try {
		config = editors.json.get().json || JSON.parse(editors.json.get().text)
	}
	catch {
		return
	}
	editors.json.set({
		json: {
			...config,
			model: entry.modelId,
			url: providerApiToCompletionsUrl(entry.providerApi),
		},
	})
}

/**
 * 确保搜索 UI 已挂载并返回各区域元素引用。
 * @param {HTMLElement} container - 展示容器。
 * @returns {{ root: HTMLElement, detailCard: HTMLElement, searchInput: HTMLInputElement, resultsList: HTMLElement, statusLine: HTMLElement }} UI 元素。
 */
function ensureSearchUi(container) {
	let root = container.querySelector('[data-proxy-models-dev]')
	if (root) return {
		root,
		detailCard: root.querySelector('[data-detail-card]'),
		searchInput: root.querySelector('[data-search-input]'),
		resultsList: root.querySelector('[data-results-list]'),
		statusLine: root.querySelector('[data-status-line]'),
	}

	root = document.createElement('div')
	root.dataset.proxyModelsDev = '1'
	root.className = 'flex flex-col gap-3'

	const detailCard = document.createElement('div')
	detailCard.dataset.detailCard = '1'

	const searchTitle = document.createElement('h3')
	searchTitle.className = 'text-lg font-semibold'
	searchTitle.dataset.i18n = 'serviceSource_manager.common_config_interface.modelSearchTitle'

	const searchInput = document.createElement('input')
	searchInput.type = 'search'
	searchInput.className = 'input input-bordered w-full'
	searchInput.dataset.searchInput = '1'
	searchInput.dataset.i18n = 'serviceSource_manager.common_config_interface.modelSearch'

	const searchHint = document.createElement('p')
	searchHint.className = 'text-sm opacity-70'
	searchHint.dataset.i18n = 'serviceSource_manager.common_config_interface.modelSearchHint'

	const statusLine = document.createElement('div')
	statusLine.dataset.statusLine = '1'
	statusLine.className = 'text-sm opacity-70'

	const resultsList = document.createElement('div')
	resultsList.dataset.resultsList = '1'
	resultsList.className = 'flex flex-col gap-1 max-h-96 overflow-y-auto'

	root.append(detailCard, searchTitle, searchInput, searchHint, statusLine, resultsList)
	container.replaceChildren(root)

	return { root, detailCard, searchInput, resultsList, statusLine }
}

/**
 * 追加带 i18n 的元数据行。
 * @param {HTMLElement} parent - 父容器。
 * @param {string} i18nKey - 翻译键。
 * @param {Record<string, string|number>} params - dataset 插值参数。
 * @returns {void}
 */
function appendMetaRow(parent, i18nKey, params) {
	const row = document.createElement('div')
	row.className = 'text-sm'
	row.dataset.i18n = i18nKey
	for (const [key, value] of Object.entries(params))
		row.dataset[key] = String(value ?? '—')
	parent.appendChild(row)
}

/**
 * 渲染当前 config 匹配到的模型详情卡片。
 * @param {HTMLElement} detailCard - 详情卡片区。
 * @param {object|null} entry - 目录条目。
 * @returns {void}
 */
function renderDetailCard(detailCard, entry) {
	detailCard.replaceChildren()
	if (!entry) return

	const card = document.createElement('div')
	card.className = 'rounded-lg border border-base-300 bg-base-200 p-4 flex flex-col gap-2'

	const title = document.createElement('h4')
	title.className = 'text-base font-semibold'
	title.dataset.i18n = 'serviceSource_manager.common_config_interface.currentModelTitle'
	title.dataset.name = entry.modelName
	title.dataset.model = entry.modelId

	const provider = document.createElement('div')
	provider.className = 'text-sm opacity-80'
	provider.dataset.i18n = 'serviceSource_manager.common_config_interface.providerLabel'
	provider.dataset.provider = entry.providerName

	appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaContext', {
		context: entry.context ?? '—',
	})
	appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaOutputLimit', {
		output: entry.outputLimit ?? '—',
	})
	appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaInputPrice', {
		price: formatTokenPrice(entry.cost?.input),
	})
	appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaOutputPrice', {
		price: formatTokenPrice(entry.cost?.output),
	})
	if (entry.cost?.cache_read != null || entry.cost?.cache_write != null)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaCachePrice', {
			read: formatTokenPrice(entry.cost?.cache_read),
			write: formatTokenPrice(entry.cost?.cache_write),
		})

	const inputModalities = (entry.modalities?.input || []).join(', ') || '—'
	const outputModalities = (entry.modalities?.output || []).join(', ') || '—'
	appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaModalities', {
		input: inputModalities,
		output: outputModalities,
	})

	if (entry.reasoning)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaReasoning', {})
	if (entry.toolCall)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaToolCall', {})
	if ((entry.modalities?.input || []).includes('image'))
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaVision', {})
	if (entry.openWeights)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaOpenWeights', {})
	if (entry.knowledge)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaKnowledge', {
			knowledge: entry.knowledge,
		})
	if (entry.releaseDate)
		appendMetaRow(card, 'serviceSource_manager.common_config_interface.metaReleaseDate', {
			date: entry.releaseDate,
		})

	if (entry.providerDoc) {
		const docLink = document.createElement('div')
		docLink.className = 'text-sm'
		docLink.dataset.i18n = 'serviceSource_manager.common_config_interface.providerDocLink'
		docLink.dataset.url = entry.providerDoc
		card.appendChild(docLink)
	}

	card.prepend(title, provider)
	detailCard.appendChild(card)
}

/**
 * 渲染候选行徽章。
 * @param {HTMLElement} badges - 徽章容器。
 * @param {object} entry - 目录条目。
 * @returns {void}
 */
function renderCandidateBadges(badges, entry) {
	const items = []
	if (entry.context != null)
		items.push(String(entry.context))
	if (entry.cost?.input != null)
		items.push(formatTokenPrice(entry.cost.input))
	if (entry.reasoning) items.push('R')
	if (entry.toolCall) items.push('T')
	if ((entry.modalities?.input || []).includes('image')) items.push('V')

	for (const text of items) {
		const badge = document.createElement('span')
		badge.className = 'badge badge-sm badge-ghost'
		badge.textContent = text
		badges.appendChild(badge)
	}
}

/**
 * 渲染搜索结果列表。
 * @param {HTMLElement} resultsList - 结果容器。
 * @param {object[]} entries - 候选条目。
 * @param {object|null} selectedEntry - 当前 config 匹配的条目。
 * @param {(entry: object) => void} onSelect - 选中回调。
 * @returns {void}
 */
function renderSearchResults(resultsList, entries, selectedEntry, onSelect) {
	resultsList.replaceChildren()
	for (const entry of entries) {
		const row = document.createElement('button')
		row.type = 'button'
		row.className = 'flex flex-col gap-1 rounded-lg px-3 py-2 text-left hover:bg-base-300 transition-colors'
		if (selectedEntry?.modelId === entry.modelId && selectedEntry?.providerId === entry.providerId)
			row.classList.add('bg-primary/10', 'ring-1', 'ring-primary/30')

		const header = document.createElement('div')
		header.className = 'flex flex-wrap items-center gap-2'

		const modelName = document.createElement('span')
		modelName.className = 'font-medium'
		modelName.textContent = entry.modelName

		const providerName = document.createElement('span')
		providerName.className = 'text-sm opacity-70'
		providerName.textContent = entry.providerName

		const badges = document.createElement('div')
		badges.className = 'flex flex-wrap gap-1'
		renderCandidateBadges(badges, entry)

		const modelId = document.createElement('span')
		modelId.className = 'text-xs opacity-60 font-mono'
		modelId.textContent = entry.modelId

		header.append(modelName, providerName, badges)
		row.append(header, modelId)
		row.addEventListener('click', () => onSelect(entry))
		resultsList.appendChild(row)
	}
}

/**
 * 显示状态行文案。
 * @param {HTMLElement} statusLine - 状态容器。
 * @param {string|null} i18nKey - 翻译键。
 * @param {Record<string, string>} [params] - 插值参数。
 * @returns {void}
 */
function showStatus(statusLine, i18nKey, params = {}) {
	statusLine.replaceChildren()
	if (!i18nKey) return
	const node = document.createElement('div')
	node.dataset.i18n = i18nKey
	for (const [key, value] of Object.entries(params))
		node.dataset[key] = value
	statusLine.appendChild(node)
}

return async function({ data, containers, editors }) {
	const container = containers.generatorDisplay
	const { detailCard, searchInput, resultsList, statusLine } = ensureSearchUi(container)

	let catalog
	try {
		if (!cache.catalog)
			showStatus(statusLine, 'serviceSource_manager.common_config_interface.modelsDevLoading')
		catalog = await loadModelsCatalog()
		showStatus(statusLine, null)
	}
	catch (error) {
		console.error('Failed to fetch models.dev catalog:', error)
		showStatus(statusLine, 'serviceSource_manager.common_config_interface.modelsDevLoadFailed', {
			message: error.message,
		})
		return
	}

	const selectedEntry = findCatalogEntry(catalog, data)
	renderDetailCard(detailCard, selectedEntry)

	/**
	 * 根据搜索框内容刷新候选列表。
	 * @returns {void}
	 */
	const refreshSearchResults = () => {
		const query = searchInput.value
		if (!query.trim()) {
			resultsList.replaceChildren()
			showStatus(statusLine, null)
			return
		}
		const matches = searchCatalog(catalog, query)
		if (!matches.length) {
			resultsList.replaceChildren()
			showStatus(statusLine, 'serviceSource_manager.common_config_interface.noModelsMatched')
			return
		}
		showStatus(statusLine, null)
		renderSearchResults(resultsList, matches, selectedEntry, entry => applyConfigFromEntry(editors, entry))
	}

	/** 搜索输入防抖。 */
	searchInput.oninput = () => {
		clearTimeout(cache.searchDebounceTimer)
		cache.searchDebounceTimer = setTimeout(refreshSearchResults, SEARCH_DEBOUNCE_MS)
	}

	if (searchInput.value.trim())
		refreshSearchResults()
}
