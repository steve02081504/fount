/* global globalThis, Response */
/**
 * 仅在隔离测试节点中模拟 Codex 的两个上游目录请求；不发出真实 OAuth 请求。
 * @param {string} username - 测试用户名。
 * @returns {Promise<void>} 安装测试 fetch。
 */
export default async function bootstrap(username) {
	void username
	const realFetch = globalThis.fetch
	globalThis.fetch = (input, init) => {
		const url = String(input instanceof Request ? input.url : input)
		if (url === 'https://registry.npmjs.org/@openai%2fcodex/latest')
			return Promise.resolve(Response.json({ version: '0.157.1' }))
		if (url.startsWith('https://chatgpt.com/backend-api/codex/models?')) {
			if (init?.headers?.Authorization !== 'Bearer synthetic-ui-token' || init.headers['ChatGPT-Account-Id'] !== 'synthetic-account')
				throw new Error('Unexpected test catalog authorization')
			return Promise.resolve(Response.json({ models: [
				{ slug: 'model-a', display_name: 'Model A', visibility: 'list', supported_in_api: true,
					default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }] },
				{ slug: 'model-b', display_name: 'Model B', visibility: 'list', supported_in_api: true,
					default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }] },
				{ slug: 'hidden', visibility: 'hide', supported_in_api: true, supported_reasoning_levels: [{ effort: 'max' }] },
			] }))
		}
		return realFetch(input, init)
	}
}
