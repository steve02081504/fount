/* global geti18n */

let last_apikey = ''
let last_base_url = ''

return async ({ data, containers }) => {
	const div = containers.generatorDisplay
	const { apikey, base_url } = data
	if (!apikey) {
		div.innerHTML = /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.apiKeyRequired"></div>'
		return
	}

	if (apikey === last_apikey && (base_url || '') === (last_base_url || '')) return
	last_apikey = apikey
	last_base_url = base_url || ''

	div.innerHTML = /* html */ '<div data-i18n="serviceSource_manager.common_config_interface.loadingModels"></div>'

	try {
		const { GoogleGenAI } = await import('https://esm.sh/@google/genai')

		const ai = new GoogleGenAI({
			apiKey: apikey,
			httpOptions: base_url ? {
				baseUrl: base_url
			} : undefined
		})

		const modelInfo = await ai.models.list()
		const models = []

		for await (const model of modelInfo)
			models.push(model.name)

		const model_ids = models.map(m => m.replace(/^models\//, '')).sort()
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
	catch (error) {
		console.error('Failed to fetch models:', error)
		div.innerHTML = /* html */ `
<div class="text-error" style="overflow-wrap: break-word;">${geti18n('serviceSource_manager.common_config_interface.loadModelsFailed', { message: error.message })}</div>
`
	}
}
