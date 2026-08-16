/**
 * 冷启动等待页：入场动画期间探测 fount，入场结束后再跳转。
 */
import { expect, test } from './fixtures.mjs'

const PING = /http:\/\/localhost:8931\/api\/ping(?:\/|$|\?)/
const FOUNT_ORIGIN = /http:\/\/localhost:8931(?:\/|$|\?)/

/**
 * 拦截本机 fount：`/api/ping` 与跳转后的页面。
 * @param {import('npm:@playwright/test').Page} page 页
 * @param {{ pingOk?: boolean }} [options] ping 是否成功
 * @returns {Promise<{ pingHits: number }>} 命中计数（对象，便于闭包更新）
 */
async function mockLocalFount(page, options = {}) {
	const pingOk = options.pingOk ?? true
	const hits = { pingHits: 0 }
	await page.route(FOUNT_ORIGIN, async route => {
		const url = route.request().url()
		if (PING.test(url)) {
			hits.pingHits++
			if (!pingOk) {
				await route.abort('connectionrefused')
				return
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'Access-Control-Allow-Origin': '*' },
				body: JSON.stringify({ client_name: 'fount' }),
			})
			return
		}
		await route.fulfill({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			body: '<!DOCTYPE html><html><body><main>fount-home</main></body></html>',
		})
	})
	return hits
}

test.describe('cold-boot wait', () => {
	test.afterEach(async ({ page }) => {
		if (page.isClosed()) return
		try {
			await page.evaluate(() => globalThis.icon?.dismiss?.())
		}
		catch { /* 已跳走 */ }
	})

	test('plays icon while pinging, stays until intro if fount is down', async ({ page, baseUrl }) => {
		const hits = await mockLocalFount(page, { pingOk: false })
		await page.goto(`${baseUrl}/wait/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#terminal')).toBeVisible()
		await expect.poll(() => hits.pingHits, { timeout: 15_000 }).toBeGreaterThan(0)
		await expect.poll(async () => page.evaluate(() => Boolean(document.querySelector('.xterm-rows')?.innerText?.trim())), {
			timeout: 15_000,
		}).toBe(true)
		await expect(page).toHaveURL(/\/wait\/?/)
	})

	test('jumps only after intro when fount is already up', async ({ page, baseUrl }) => {
		test.setTimeout(60_000)
		const hits = await mockLocalFount(page, { pingOk: true })
		await page.goto(`${baseUrl}/wait/`, { waitUntil: 'domcontentloaded' })
		await expect.poll(() => hits.pingHits, { timeout: 15_000 }).toBeGreaterThan(0)
		await expect(page).toHaveURL(/\/wait\/?/)
		await page.evaluate(() => globalThis.icon?.dismiss?.())
		await expect(page).toHaveURL(/localhost:8931/, { timeout: 15_000 })
		await expect(page.locator('main')).toContainText('fount-home')
	})
})
