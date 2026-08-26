import { geti18n } from '../../i18n/bare.mjs'

import { withApiRequest } from './api.mjs'

/**
 * 断言当前 Playwright 跑在 run.mjs 自启的隔离节点上。
 * @param {object} options 选项
 * @param {string} options.baseUrl 测试根 URL
 * @param {string} options.apiKey API 密钥
 * @param {string} options.expectedUsername 预期隔离用户名
 * @param {string} options.shellLabel 用于错误提示的 shell 名称（如 Chat、Social）
 * @returns {Promise<void>}
 */
export async function assertIsolatedFrontendTest({ baseUrl, apiKey, expectedUsername, shellLabel }) {
	if (process.env.FOUNT_TEST_ISOLATED !== '1')
		throw new Error(geti18n('fountConsole.test.frontend.isolatedRequired', { shellLabel }))
	await withApiRequest(async api => {
		const whoami = await api.get(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		if (!whoami.ok())
			throw new Error(`whoami failed: ${whoami.status()}`)
		const data = await whoami.json()
		if (data.username !== expectedUsername)
			throw new Error(geti18n('fountConsole.test.frontend.isolatedUser', { expectedUsername, username: data.username }))
	})
}
