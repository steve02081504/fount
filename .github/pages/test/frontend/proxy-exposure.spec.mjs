import { expect, test } from './fixtures.mjs'

test('proxy exposure notice explains shutdown and recovery in the selected locale', async ({ page, baseUrl }) => {
	await page.addInitScript(() => localStorage.setItem('fountUserPreferredLanguages', JSON.stringify(['zh-CN'])))
	await page.goto(`${baseUrl}/proxy-exposure/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('h1')).toContainText('fount 已停用 Web 服务')
	await expect(page.locator('[data-i18n="proxy_exposure.risk.text"]')).toContainText('本机权限')
	await expect(page.locator('[data-i18n="proxy_exposure.action.text"]')).toContainText('500')
	await expect(page.locator('[data-i18n="proxy_exposure.recovery.restart"]')).toContainText('fount reboot')
	await expect(page.locator('#language')).toHaveValue('zh-CN')
	await expect(page.locator('#language option')).not.toHaveCount(0)
	await expect(page.locator('#watching')).toContainText('眼睛')
})

test('sound defaults to on and the toggle remembers mute', async ({ page, baseUrl }) => {
	await page.goto(`${baseUrl}/proxy-exposure/`, { waitUntil: 'domcontentloaded' })
	const sound = page.locator('#sound')
	await expect(sound).toHaveAttribute('aria-label', '关掉门后的声音')
	await sound.click()
	await expect(sound).toHaveAttribute('aria-label', '打开门后的声音')
	expect(await page.evaluate(() => localStorage.getItem('fount.proxyExposure.muted'))).toBe('1')
})

test('pressing and holding the page reveals the lucid paper and releasing restores it', async ({ page, baseUrl }) => {
	await page.goto(`${baseUrl}/proxy-exposure/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('[data-i18n="proxy_exposure.hint"]')).not.toBeEmpty()
	await page.mouse.move(40, 450)
	await page.mouse.down()
	await expect(page.locator('body')).toHaveClass(/lucid/)
	await expect(page.locator('[data-i18n="proxy_exposure.lucid"]')).toBeVisible()
	await page.mouse.up()
	await expect(page.locator('body')).not.toHaveClass(/lucid/)
})
