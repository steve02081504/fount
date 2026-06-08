let cachedCacheKey = ''
/** @type {string[]|null} */
let cachedModelIds = null
let latestModelsRequestId = 0

/**
 * 根据 API key 与 base URL 生成缓存键。
 * @param {string} apikey - API key。
 * @param {string} [base_url] - 自定义 base URL。
 * @returns {string} 缓存键。
 */
function modelsCacheKey(apikey, base_url) {
	return (base_url || '') + '\0' + apikey
}

/**
 * 重置模型 ID 缓存。
 * @returns {void}
 */
function resetModelIdsCache() {
	cachedCacheKey = ''
	cachedModelIds = null
}

/**
 * 从 Gemini API 拉取模型 ID 列表，并更新模块内缓存。
 * @param {string} apikey - API key。
 * @param {string} [base_url] - 自定义 base URL。
 * @param {string} cacheKey - 缓存键。
 * @returns {Promise<string[]>} 模型 ID 列表。
 */
async function fetchModelIds(apikey, base_url, cacheKey) {
	const { GoogleGenAI } = await import('https://esm.sh/@google/genai')

	const ai = new GoogleGenAI({
		apiKey: apikey,
		httpOptions: base_url ? { baseUrl: base_url } : undefined
	})

	const model_ids = []
	for await (const model of await ai.models.list())
		model_ids.push(model.name.replace(/^models\//, ''))

	cachedCacheKey = cacheKey
	return cachedModelIds = model_ids
}

/**
 * 获取模型 ID 列表；命中模块内缓存则直接返回，否则拉取。
 * @param {string} apikey - API key。
 * @param {string} [base_url] - 自定义 base URL。
 * @param {() => void} [onLoading] - 即将发起网络请求时调用。
 * @returns {Promise<string[]>} 模型 ID 列表。
 */
async function getModelIds(apikey, base_url, onLoading) {
	const cacheKey = modelsCacheKey(apikey, base_url)
	if (cacheKey === cachedCacheKey && cachedModelIds)
		return cachedModelIds

	onLoading?.()
	return fetchModelIds(apikey, base_url, cacheKey)
}

/**
 * 渲染缺少 API key 的提示。
 * @param {HTMLElement} div - 展示容器。
 * @returns {void}
 */
function showApiKeyRequired(div) {
	div.replaceChildren()
	const warning = document.createElement('div')
	warning.className = 'text-warning'
	warning.dataset.i18n = 'serviceSource_manager.common_config_interface.apiKeyRequired'
	div.appendChild(warning)
}

/**
 * 在拉取模型列表期间显示 loading 占位内容。
 * @param {HTMLElement} div - 展示容器。
 * @returns {void}
 */
function showModelsLoading(div) {
	div.replaceChildren()
	const loading = document.createElement('div')
	loading.dataset.i18n = 'serviceSource_manager.common_config_interface.loadingModels'
	div.appendChild(loading)
}

/**
 * 在配置区域渲染可点击复制的模型 ID 列表。
 * @param {HTMLElement} div - 展示容器。
 * @param {string[]} model_ids - 模型 ID 列表。
 * @returns {void}
 */
function renderModels(div, model_ids) {
	div.replaceChildren()
	const h3 = document.createElement('h3')
	h3.className = 'text-lg font-semibold'
	h3.dataset.i18n = 'serviceSource_manager.common_config_interface.availableModels'
	const p = document.createElement('p')
	p.className = 'text-sm opacity-70'
	p.dataset.i18n = 'serviceSource_manager.common_config_interface.copyModelIdTooltip'
	const list = document.createElement('div')
	list.className = 'flex flex-wrap gap-2 mt-2'
	for (const id of model_ids) {
		const code = document.createElement('code')
		code.className = 'p-1 bg-base-300 rounded cursor-pointer hover:bg-primary hover:text-primary-content'
		code.textContent = id
		code.addEventListener('click', () => {
			navigator.clipboard.writeText(id)
			code.dataset.i18n = 'serviceSource_manager.common_config_interface.copied'
			setTimeout(() => {
				delete code.dataset.i18n
				code.textContent = id
			}, 1000)
		})
		list.appendChild(code)
	}
	div.append(h3, p, list)
}

/**
 * 渲染模型列表拉取失败的错误信息。
 * @param {HTMLElement} div - 展示容器。
 * @param {Error} error - 拉取错误。
 * @returns {void}
 */
function showModelsError(div, error) {
	console.error('Failed to fetch models:', error)
	div.replaceChildren()
	const errorDiv = document.createElement('div')
	errorDiv.className = 'text-error'
	errorDiv.style.overflowWrap = 'break-word'
	errorDiv.dataset.i18n = 'serviceSource_manager.common_config_interface.loadModelsFailed'
	errorDiv.dataset.message = error.message
	div.appendChild(errorDiv)
}

return async function({ data, containers }) {
	const div = containers.generatorDisplay
	const { apikey, base_url } = data
	if (!apikey?.trim()) {
		resetModelIdsCache()
		return showApiKeyRequired(div)
	}

	const requestId = ++latestModelsRequestId
	try {
		const modelIds = await getModelIds(apikey, base_url || '', function onLoading() {
			if (requestId === latestModelsRequestId) showModelsLoading(div)
		})
		if (requestId !== latestModelsRequestId) return
		renderModels(div, modelIds)
	}
	catch (error) {
		if (requestId !== latestModelsRequestId) return
		showModelsError(div, error)
	}
}
