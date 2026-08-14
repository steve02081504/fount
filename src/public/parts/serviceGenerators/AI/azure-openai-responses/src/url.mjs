/**
 * Azure OpenAI Responses 端点。
 * @param {object} config - 配置。
 * @returns {string} `/openai/v1/responses` URL。
 */
export function azureResponsesUrl(config) {
	if (config.url) {
		const trimmed = config.url.replace(/\/$/, '')
		if (trimmed.endsWith('/responses')) return trimmed
		if (trimmed.endsWith('/openai/v1')) return `${trimmed}/responses`
		return `${trimmed}/openai/v1/responses`
	}
	const base = (config.endpoint || `https://${config.resource}.openai.azure.com`).replace(/\/$/, '')
	return `${base}/openai/v1/responses`
}
