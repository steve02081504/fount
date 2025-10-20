/* global geti18n */

let last_url = ''
let last_apikey = ''
const normalizeUrl = url => {
	let urlObj
	try {
		urlObj = new URL(url)
	}
	catch {
		if (!url.startsWith('http'))
			try {
				urlObj = new URL('https://' + url)
			}
			catch {
				try {
					urlObj = new URL('http://' + url)
				}
				catch {
					return null
				}
			}
		else return null
	}
	if (urlObj.pathname.includes('/chat/completions'))
		urlObj.pathname = urlObj.pathname.replace(/\/chat\/completions.*$/, '/models')
	else if (urlObj.pathname.endsWith('/'))
		urlObj.pathname += 'v1/models'
	else
		urlObj.pathname += '/v1/models'

	return urlObj.toString()
}
return async ({ data, containers }) => {
	const div = containers.generatorDisplay
	const { url, apikey } = data
	if (!url) return div.innerHTML = ''
	const modelsUrl = normalizeUrl(url)
	if (!modelsUrl) return div.innerHTML = ''
	if (modelsUrl === last_url && apikey === last_apikey) return
	last_url = modelsUrl
	last_apikey = apikey
	div.innerHTML = '<div data-i18n="aisource_editor.common_config_interface.loadingModels"></div>'
	try {
		const response = await fetch(modelsUrl, {
			headers: { Authorization: apikey ? 'Bearer ' + apikey : undefined }
		})
		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Could not read error body.')
			throw new Error(`${response.status} ${response.statusText}: ${errorText}`)
		}
		const result = await response.json()
		const models = result.data || result
		if (!Array.isArray(models))
			throw new Error('Response is not an array of models.')

		const model_ids = models.map(m => m.id).sort()
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
