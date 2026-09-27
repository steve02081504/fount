/**
 * 用已登录的 Codex 账号取得可选模型及其推理强度。
 * client_version 来自 Codex CLI 最新正式发行版；版本查询不携带 OAuth 凭证。
 * @param {{access: string, accountId: string}} credentials - Codex OAuth 凭证。
 * @param {typeof fetch} [fetcher] - 请求函数。
 * @returns {Promise<Array<object>>} 不含凭证的模型资料。
 */
export async function fetchCodexModels(credentials, fetcher = fetch) {
	const versionResponse = await fetcher('https://registry.npmjs.org/@openai%2fcodex/latest')
	if (!versionResponse.ok) throw new Error(`Codex client version lookup ${versionResponse.status}`)
	const { version } = await versionResponse.json()
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
		throw new Error('Codex client version is unavailable')

	const url = new URL('https://chatgpt.com/backend-api/codex/models')
	url.searchParams.set('client_version', version)
	const response = await fetcher(url, {
		redirect: 'error',
		headers: {
			Authorization: `Bearer ${credentials.access}`,
			'ChatGPT-Account-Id': credentials.accountId,
			'OpenAI-Beta': 'responses=v1',
			originator: 'fount',
		},
	})
	if (!response.ok) throw new Error(`Codex model catalog ${response.status}`)
	const { models } = await response.json()
	if (!Array.isArray(models)) throw new Error('Invalid Codex model catalog')
	return models
		.filter(model => model.visibility === 'list' && model.supported_in_api !== false && typeof model.slug === 'string' && model.slug)
		.map(model => ({
			slug: model.slug,
			displayName: typeof model.display_name === 'string' ? model.display_name : model.slug,
			defaultReasoningLevel: typeof model.default_reasoning_level === 'string' ? model.default_reasoning_level : null,
			supportedReasoningLevels: Array.isArray(model.supported_reasoning_levels)
				? model.supported_reasoning_levels.map(level => typeof level === 'string' ? level : level?.effort).filter(level => typeof level === 'string' && level)
				: [],
		}))
}
