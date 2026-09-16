/**
 * WeChat bot URL `char` 参数模板预填与 QR 登录合并回归。
 * 回归对象 1：`?name=X&char=Y` 下新建 bot 应预填角色配置模板，而非留 `{}`，且下拉应真正选中。
 * 回归对象 2：扫码成功后只把登录结果赋值进当前编辑器，不得整份重载配置清空未保存内容。
 */
import { test, expect } from './fixtures.mjs'

test.describe('WeChat bot URL char template prefill', () => {
	test('URL char param pre-fills a fresh bot with the char config template', async ({ page, baseUrl }) => {
		const botname = `url-char-fresh-${Date.now()}`
		await page.goto(`${baseUrl}/parts/shells:wechatbot/?name=${botname}&char=urlChar`, {
			waitUntil: 'domcontentloaded',
		})
		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })
		await expect(content).toContainText('URL_CHAR_TEMPLATE_OWNER')
		await expect(page.locator('#bot-list-dropdown > input')).toHaveValue(botname)
		await expect(page.locator('#char-select-dropdown > input')).toHaveValue('urlChar')
	})

	test('URL char param does not clobber a saved non-empty config', async ({ page, baseUrl }) => {
		const botname = `url-char-saved-${Date.now()}`
		expect((await page.request.post(`${baseUrl}/api/parts/shells:wechatbot/setbotconfig`, {
			data: {
				botname,
				config: { token: 'test-token', char: 'saved-char', config: { OwnerWeChatId: 'SAVED_OWNER' } },
			},
		})).ok()).toBeTruthy()

		await page.goto(`${baseUrl}/parts/shells:wechatbot/?name=${botname}&char=urlChar`, {
			waitUntil: 'domcontentloaded',
		})
		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#char-select-dropdown')).toHaveAttribute('data-value', 'urlChar')
		await expect(content).toContainText('SAVED_OWNER')
		await expect(content).not.toContainText('URL_CHAR_TEMPLATE_OWNER')
	})
})

test.describe('WeChat bot QR login merge', () => {
	test('QR success assigns token without wiping the editor config', async ({ page, baseUrl }) => {
		const botname = `qr-merge-${Date.now()}`
		await page.route('**/api/parts/shells:wechatbot/qrcode/start', route => route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ sessionKey: 'test-session', qrcodeContent: 'wechat-qr-content' }),
		}))
		await page.route('**/api/parts/shells:wechatbot/qrcode/poll**', route => route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				done: true,
				connected: true,
				token: 'qr-token',
				apiBaseUrl: 'https://qr.example.com/',
				ilinkUserId: 'wx-qr-owner',
				botname,
			}),
		}))

		await page.goto(`${baseUrl}/parts/shells:wechatbot/?name=${botname}&char=urlChar`, {
			waitUntil: 'domcontentloaded',
		})
		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })
		await expect(content).toContainText('URL_CHAR_TEMPLATE_PROMPT')

		await page.locator('#qr-start').click()

		await expect(page.locator('#token-input')).toHaveValue('qr-token')
		await expect(page.locator('#api-base-url')).toHaveValue('https://qr.example.com')
		await expect(content).toContainText('URL_CHAR_TEMPLATE_PROMPT')
	})
})
