import { expect, test } from './fixtures.mjs'

test('captcha explains the check and rejects incomplete links', async ({ page, baseUrl }) => {
	await page.goto(`${baseUrl}/captcha/`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#status-text')).toHaveText('这个链接无法使用。请回到刚才的页面，重新开始验证。')
	await expect(page.locator('#install-help')).toBeHidden()
	await page.locator('#why-button').click()
	await expect(page.locator('#why-tip')).toBeVisible()
	await expect(page.locator('#why-tip')).toContainText('关闭此页面即可')
	await page.mouse.move(0, 0)
	await page.locator('#why-button').press('Escape')
	await expect(page.locator('#why-tip')).toBeHidden()
})

test('captcha accepts a local proof and gives a clear next step', async ({ page, baseUrl }) => {
	await page.route('http://localhost:893*/api/p2p/verification/local?*', route => route.fulfill({
		json: { status: 'verified', nodeHash: 'a'.repeat(64) },
		headers: { 'Access-Control-Allow-Origin': '*' },
	}))
	const params = new URLSearchParams({ requesterNodeHash: 'b'.repeat(64), challenge: 'c'.repeat(64), expiresAt: String(Date.now() + 60000) })
	await page.goto(`${baseUrl}/captcha/?${params}`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#status-text')).toHaveText('验证通过！请回到刚才的页面继续操作。')
	await expect(page.locator('#install-help')).toBeHidden()
})


test('captcha shows actionable installation steps while waiting for a connection', async ({ page, baseUrl }) => {
	await page.route('http://localhost:893*/api/p2p/verification/local?*', route => route.fulfill({
		json: { status: 'failed', reason: 'not reachable' },
		headers: { 'Access-Control-Allow-Origin': '*' },
	}))
	const params = new URLSearchParams({ requesterNodeHash: 'b'.repeat(64), challenge: 'c'.repeat(64), expiresAt: String(Date.now() + 60000) })
	await page.goto(`${baseUrl}/captcha/?${params}`, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('#install-help')).toBeVisible()
	await expect(page.locator('#copy-command')).toHaveText('复制命令')
	await expect(page.locator('#install-command')).toContainText('background keepalive')
	await expect(page.locator('#status-text')).toHaveText('正在连接，请保持窗口打开。连接成功后会自动完成验证。')
})
