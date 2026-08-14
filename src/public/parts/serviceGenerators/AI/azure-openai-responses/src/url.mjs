/**
 * Azure OpenAI Responses 端点。
 * @param {object} config - 配置。
 * @returns {string} `/openai/v1/responses` URL。
 */
export function azureResponsesUrl(config) {
	let base = config.endpoint || (config.resource && `https://${config.resource}.openai.azure.com`) || ''
	if (base && !base.includes('://')) base = `https://${base}`
	return `${base.replace(/\/$/, '')}/openai/v1/responses`
}
