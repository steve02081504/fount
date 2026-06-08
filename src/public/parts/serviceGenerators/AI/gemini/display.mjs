/* global geti18n */

let cachedCacheKey = ''
/** @type {string[]|null} */
let cachedModelIds = null

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
	div.innerHTML = /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.apiKeyRequired"></div>'
}

/**
 * 在拉取模型列表期间显示 loading 占位内容。
 * @param {HTMLElement} div - 展示容器。
 * @returns {void}
 */
function showModelsLoading(div) {
	div.innerHTML = /* html */ '<div data-i18n="serviceSource_manager.common_config_interface.loadingModels"></div>'
}

/**
 * 在配置区域渲染可点击复制的模型 ID 列表。
 * @param {HTMLElement} div - 展示容器。
 * @param {string[]} model_ids - 模型 ID 列表。
 * @returns {void}
 */
function renderModels(div, model_ids) {
	const copied_text = geti18n('serviceSource_manager.common_config_interface.copied')
	div.innerHTML = /* html */ `\
<h3 class="text-lg font-semibold" data-i18n="serviceSource_manager.common_config_interface.availableModels"></h3>
<p class="text-sm opacity-70" data-i18n="serviceSource_manager.common_config_interface.copyModelIdTooltip"></p>
<div class="flex flex-wrap gap-2 mt-2">
${model_ids.map(id => /* html */ `\
<code class="p-1 bg-base-300 rounded cursor-pointer hover:bg-primary hover:text-primary-content" title="${geti18n('serviceSource_manager.common_config_interface.copyModelIdTooltip')}" onclick="navigator.clipboard.writeText('${id}'); this.innerText='${copied_text}'; setTimeout(()=>this.innerText='${id}', 1000)">${id}</code>
`
	).join('')
}
</div>
`
}

/**
 * 渲染模型列表拉取失败的错误信息。
 * @param {HTMLElement} div - 展示容器。
 * @param {Error} error - 拉取错误。
 * @returns {void}
 */
function showModelsError(div, error) {
	console.error('Failed to fetch models:', error)
	div.innerHTML = /* html */ `
<div class="text-error" style="overflow-wrap: break-word;">${geti18n('serviceSource_manager.common_config_interface.loadModelsFailed', { message: error.message })}</div>
`
}

return async function({ data, containers }) {
	const div = containers.generatorDisplay
	const { apikey, base_url } = data
	if (!apikey?.trim()) {
		resetModelIdsCache()
		return showApiKeyRequired(div)
	}

	try {
		renderModels(div, await getModelIds(apikey, base_url || '', function onLoading() {
			showModelsLoading(div)
		}))
	}
	catch (error) {
		showModelsError(div, error)
	}
}
