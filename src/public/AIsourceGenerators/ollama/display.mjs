/* global geti18n */

let last_host = ''

// Ollama's model list endpoint is /api/tags
/**
 * 获取模型 URL。
 * @param {string} host - 主机。
 * @returns {string|null} 模型 URL。
 */
const getModelsUrl = host => {
	let urlObj
	try {
		urlObj = new URL(host)
	}
	catch {
		// try to fix the url
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

return async ({ data, containers }) => {
	const div = containers.generatorDisplay
	const { host } = data
	if (!host) {
		div.innerHTML = ''
		return
	}

	const modelsUrl = getModelsUrl(host)
	if (!modelsUrl) {
		div.innerHTML = '<div class="text-warning">Invalid host URL</div>'
		return
	}

	if (modelsUrl === last_host) return
	last_host = modelsUrl

	div.innerHTML = '<div data-i18n="aisource_editor.common_config_interface.loadingModels"></div>'

	try {
		const response = await fetch(modelsUrl)
		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Could not read error body.')
			throw new Error(`${response.status} ${response.statusText}: ${errorText}`)
		}
		const result = await response.json()
		const models = result.models
		if (!Array.isArray(models))
			throw new Error('Response is not an array of models.')

		const model_ids = models.map(m => m.name).sort()
		const copied_text = geti18n('aisource_editor.common_config_interface.copied')
		div.innerHTML = `
<h3 class="text-lg font-semibold" data-i18n="aisource_editor.common_config_interface.availableModels"></h3>
<p class="text-sm opacity-70" data-i18n="aisource_editor.common_config_interface.copyModelIdTooltip"></p>
<div class="flex flex-wrap gap-2 mt-2">
${model_ids.map(id => `
<code class="p-1 bg-base-300 rounded cursor-pointer hover:bg-primary hover:text-primary-content" title="${geti18n('aisource_editor.common_config_interface.copyModelIdTooltip')}" onclick="navigator.clipboard.writeText('${id}'); this.innerText='${copied_text}'; setTimeout(()=>this.innerText='${id}', 1000)">${id}</code>
`
	).join('')
}
</div>
`
	}
	catch (error) {
		console.error('Failed to fetch models:', error)
		div.innerHTML = `
<div class="text-error" style="overflow-wrap: break-word;">${geti18n('aisource_editor.common_config_interface.loadModelsFailed', { message: error.message })}</div>
`
	}
}
