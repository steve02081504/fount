/* global geti18n */

let last_apikey = ''
let last_proxy_url = ''

return async ({ data, containers }) => {
	const div = containers.generatorDisplay
	const { apikey, proxy_url } = data
	if (!apikey) {
		div.innerHTML = `<div class="text-warning">${geti18n('aisource_editor.common_config_interface.apiKeyRequired')}</div>`
		return
	}

	if (apikey === last_apikey && (proxy_url || '') === (last_proxy_url || '')) return
	last_apikey = apikey
	last_proxy_url = proxy_url || ''

	div.innerHTML = `<div>${geti18n('aisource_editor.common_config_interface.loadingModels')}</div>`

	try {
		const { GoogleGenAI } = await import('https://esm.sh/@google/genai')

		const ai = new GoogleGenAI({
			apiKey: apikey,
			httpOptions: proxy_url ? {
				baseUrl: proxy_url
			} : undefined
		})

		const modelInfo = await ai.models.list()
		const models = []

		for await (const model of modelInfo)
			models.push(model.name)

		const model_ids = models.map(m => m.replace(/^models\//, '')).sort()
		const copied_text = geti18n('aisource_editor.common_config_interface.copied')
		div.innerHTML = `
<h3 class="text-lg font-semibold">${geti18n('aisource_editor.common_config_interface.availableModels')}</h3>
<p class="text-sm opacity-70">${geti18n('aisource_editor.common_config_interface.copyModelIdTooltip')}</p>
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
