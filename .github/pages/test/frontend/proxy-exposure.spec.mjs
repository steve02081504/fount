import { expect, test } from './fixtures.mjs'

test('proxy exposure notice explains shutdown and recovery in the selected locale', async ({ page, baseUrl }) => {
	await page.addInitScript(() => localStorage.setItem('fountUserPreferredLanguages', JSON.stringify(['zh-CN'])))
	await page.goto(`${baseUrl}/proxy-exposure/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('h1')).toHaveText('fount 已停用 Web 服务')
	await expect(page.locator('[data-i18n="proxy_exposure.risk.text"]')).toContainText('本机权限')
	await expect(page.locator('[data-i18n="proxy_exposure.action.text"]')).toContainText('500')
	await expect(page.locator('[data-i18n="proxy_exposure.recovery.restart"]')).toContainText('fount reboot')
	await expect(page.locator('#language')).toHaveValue('zh-CN')
	await expect(page.locator('#language option')).not.toHaveCount(0)
})
