/**
 * Playwright 测试用 API Key 登录，写入会话 Cookie。
 * @param {import('@playwright/test').APIRequestContext} request Playwright request 上下文
 * @param {string} baseUrl fount 根 URL
 * @param {string} apiKey API Key 明文
 * @returns {Promise<void>}
 */
export async function loginWithApiKey(request, baseUrl, apiKey) {
	const response = await request.post(`${baseUrl}/api/login`, {
		data: { apiKey, deviceid: 'playwright' },
	})
	if (!response.ok())
		throw new Error(`api/login failed: ${response.status()} ${await response.text()}`)
}
