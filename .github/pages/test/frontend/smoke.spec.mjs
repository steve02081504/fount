import { expect, test } from './fixtures.mjs'

test.describe('GitHub Pages smoke', () => {
	test('root redirects toward install wait', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/wait\/install\/?/, { timeout: 30_000 })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		// 等 hero 视觉入场结束（h1 入场前即可 AT 可达；此处断言产品动画落定）
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
	})

	test('root redirect keeps search and hash', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/?utm_source=linux.sb&rid=smoke1#welcome`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/wait\/install\/\?utm_source=linux\.sb&rid=smoke1#welcome$/, { timeout: 30_000 })
	})

	test('install wait screen loads base + test watch', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/wait/install/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watch?.started)), {
			timeout: 15_000,
		}).toBe(true)
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('h1').first()).toBeAttached()
	})

	test('utm_source shows welcome dialog after hero intro', async ({ page, baseUrl }) => {
		const dialog = page.locator('#utm-welcome-dialog')
		/**
		 * 打开带 utm_source 的安装页并等待欢迎弹窗。
		 */
		const openWelcome = async () => {
			await page.goto(`${baseUrl}/wait/install/?utm_source=linux.sb`, { waitUntil: 'domcontentloaded' })
			await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
			await expect(dialog).toBeVisible({ timeout: 5_000 })
			await expect(page.locator('#utm-welcome-message')).toContainText('linux.sb')
		}

		await openWelcome()
		await dialog.locator('.modal-action button').click()
		await expect(dialog).toBeHidden()

		await openWelcome()
		// DaisyUI 的 backdrop button 铺满全屏，中心被 modal-box 挡住；点角落才是真实关闭路径
		await dialog.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } })
		await expect(dialog).toBeHidden()
	})

	test('protocol shows offline dialog; badges render', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/protocol/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#offline_dialog')).toBeVisible({ timeout: 30_000 })

		await page.goto(`${baseUrl}/badges/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watch?.started)), {
			timeout: 15_000,
		}).toBe(true)
	})

	test('oauth bounce shows offline dialog when fount is unreachable', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/oauth/callback/?hostUrl=http://127.0.0.1:1&code=c&state=s`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#offline_dialog')).toBeVisible({ timeout: 30_000 })
	})
})
