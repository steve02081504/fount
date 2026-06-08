let cachedCacheKey = ''
/** @type {string[]|null} */
let cachedModelIds = null
let latestModelsRequestId = 0

/**
 * 将 Ollama 主机地址规范化为 `/api/tags` 端点 URL。
 * @param {string} host - 用户输入的主机地址。
 * @returns {string|null} 规范化后的 models URL；无法解析时返回 null。
 */
function getModelsUrl(host) {
	if (!host?.trim()) return null
	let urlObj
	try {
		urlObj = new URL(host)
	}
	catch {
		if (!host.startsWith('http'))
			try {
				urlObj = new URL('http://' + host)
			}
			catch {
				return null
			}
		else return null
	}
	urlObj.pathname = '/api/tags'
	return urlObj.toString()
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
 * 从网络拉取模型名称列表，并更新模块内缓存。
 * @param {string} modelsUrl - 规范化后的 `/api/tags` URL。
 * @param {string} cacheKey - 缓存键。
 * @returns {Promise<string[]>} 模型名称列表。
 */
async function fetchModelIds(modelsUrl, cacheKey) {
	const response = await fetch(modelsUrl)
	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Could not read error body.')
		throw new Error(`${response.status} ${response.statusText}: ${errorText}`)
	}
	const result = await response.json()
	const { models } = result
	if (!Array.isArray(models))
		throw new Error('Response is not an array of models.')
	cachedCacheKey = cacheKey
	return cachedModelIds = models.map(m => m.name)
}

/**
 * 获取模型名称列表；命中模块内缓存则直接返回，否则拉取。
 * @param {string} modelsUrl - 规范化后的 `/api/tags` URL。
 * @param {() => void} [onLoading] - 即将发起网络请求时调用。
 * @returns {Promise<string[]>} 模型名称列表。
 */
async function getModelIds(modelsUrl, onLoading) {
	const cacheKey = modelsUrl
	if (cacheKey === cachedCacheKey && cachedModelIds)
		return cachedModelIds

	onLoading?.()
	return fetchModelIds(modelsUrl, cacheKey)
}

/**
 * 清空模型列表展示区域。
 * @param {HTMLElement} div - 展示容器。
 * @returns {void}
 */
function clearDisplay(div) {
	div.innerHTML = ''
}

/**
 * 渲染无效主机地址提示。
 * @param {HTMLElement} div - 展示容器。
 * @returns {void}
 */
function showInvalidHost(div) {
	div.innerHTML = /* html */ '<div class="text-warning">Invalid host URL</div>'
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
 * 在配置区域渲染可点击复制的模型名称列表。
 * @param {HTMLElement} div - 展示容器。
 * @param {string[]} model_ids - 模型名称列表。
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
	const { host } = data
	const modelsUrl = getModelsUrl(host)
	if (!modelsUrl) {
		resetModelIdsCache()
		if (!host?.trim()) return clearDisplay(div)
		return showInvalidHost(div)
	}

	const requestId = ++latestModelsRequestId
	try {
		const modelIds = await getModelIds(modelsUrl, function onLoading() {
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
