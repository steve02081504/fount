let last_apikey = ''
let last_proxy_url = ''

return async ({ data, containers }) => {
	const div = containers.generatorDisplay
	const { apikey, proxy_url } = data
	if (!apikey) {
		div.innerHTML = '<div class="text-warning">API key is required to list models.</div>'
		return
	}

	if (apikey === last_apikey && (proxy_url || '') === (last_proxy_url || '')) return
	last_apikey = apikey
	last_proxy_url = proxy_url || ''

	div.innerHTML = '<div>Loading models...</div>'

	try {
		const { GoogleGenAI } = await import('https://esm.run/@google/genai')

		const ai = new GoogleGenAI({
			apiKey: apikey,
			httpOptions: proxy_url ? {
				baseUrl: proxy_url
			} : undefined
		})

		const modelInfo = await ai.models.list()
		const models = modelInfo.models

		if (!Array.isArray(models))
			throw new Error('Response is not an array of models.')

		const model_ids = models.map(m => m.name.replace(/^models\//, '')).sort()
		div.innerHTML = `
<h3 class="text-lg font-semibold">Available Models:</h3>
<p class="text-sm opacity-70">Click to copy model ID</p>
<div class="flex flex-wrap gap-2 mt-2">
${model_ids.map(id => `
<code class="p-1 bg-base-300 rounded cursor-pointer hover:bg-primary hover:text-primary-content" title="Click to copy" onclick="navigator.clipboard.writeText('${id}'); this.innerText='Copied!'; setTimeout(()=>this.innerText='${id}', 1000)">${id}</code>
`
		).join('')
			}
</div>
`
	} catch (error) {
		console.error('Failed to fetch models:', error)
		div.innerHTML = `
<div class="text-error" style="overflow-wrap: break-word;">Failed to load models: ${error.message}</div>
`
	}
}
