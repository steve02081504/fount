/**
 * Playwright 测试用 API Key 登录，写入会话 Cookie。
 * @param {import('npm:@playwright/test').APIRequestContext} request Playwright request 上下文
 * @param {string} baseUrl fount 根 URL
 * @param {string} apiKey API Key 明文
 * @returns {Promise<void>}
 */
export async function loginWithApiKey(request, baseUrl, apiKey) {
	let lastError
	for (let attempt = 0; attempt < 3; attempt++) try {
		const response = await request.post(`${baseUrl}/api/login`, {
			data: { apiKey, deviceid: 'playwright' },
		})
		if (!response.ok())
			throw new Error(`api/login failed: ${response.status()} ${await response.text()}`)
		return
	}
	catch (error) {
		lastError = error
		await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
	}
	throw lastError
}
