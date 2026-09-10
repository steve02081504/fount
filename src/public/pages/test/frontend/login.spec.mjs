/**
 * 登录/注册页：本机来源注册不应要求验证码。
 *
 * 用匿名 context 打开 /login（fixture 默认 context 已登录，会跳走），
 * 切到注册表单后断言验证码分组隐藏，并在不填验证码的情况下注册成功（201）。
 */
import { test, expect } from './fixtures.mjs'

test('local registration does not require a verification code', async ({ browser, baseUrl }) => {
	const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' })
	try {
		const page = await context.newPage()
		await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#submit-button')).toBeVisible({ timeout: 30_000 })

		await page.locator('#toggle-link a').click()
		await expect(page.locator('#confirm-password-group')).toBeVisible()

		// 本机来源（local origin）→ 不需要验证码，分组保持隐藏
		await expect(page.locator('#verification-code-group')).toBeHidden()

		const username = `local-register-${Date.now().toString(36)}`
		const password = 'Str0ng-Passw0rd!x9Z'
		await page.locator('#username').fill(username)
		await page.locator('#password').fill(password)
		await page.locator('#confirm-password').fill(password)

		const [response] = await Promise.all([
			page.waitForResponse(resp => resp.url().includes('/api/register') && resp.request().method() === 'POST'),
			page.locator('#submit-button').click(),
		])
		expect(response.status()).toBe(201)

		// 注册成功后切回登录表单
		await expect(page.locator('#confirm-password-group')).toBeHidden()
	}
	finally {
		await context.close()
	}
})
