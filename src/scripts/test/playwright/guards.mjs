import { request as playwrightRequest } from '@playwright/test'

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
		throw new Error(
			`${shellLabel} 前端测试须通过 test/frontend/run.mjs 启动（自启隔离节点），`
			+ '勿对本地开发实例或真实用户数据运行。',
		)
	const api = await playwrightRequest.newContext()
	try {
		const whoami = await api.get(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		if (!whoami.ok())
			throw new Error(`whoami failed: ${whoami.status()}`)
		const data = await whoami.json()
		if (data.username !== expectedUsername)
			throw new Error(
				`测试须使用隔离用户 "${expectedUsername}"，当前为 "${data.username}"。`
				+ '请通过 run.mjs 启动，勿指向生产/开发 fount。',
			)
	}
	finally {
		await api.dispose()
	}
}
