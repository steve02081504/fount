/**
 * debug_info shell 前端 smoke：页面可加载、系统信息表渲染。
 */
import { test, expect } from './fixtures.mjs'

test.beforeEach(async ({ page }) => {
	// 所有用例都在真实页面上跑版本检查，先给 GitHub compare 一个「已是最新」的默认答案。
	await page.route('https://api.github.com/**', route => route.fulfill({ json: {
		status: 'identical', ahead_by: 0, behind_by: 0, base_commit: { sha: 'a'.repeat(40) },
	} }))
})

test.describe('debug_info shell smoke', () => {
	test('debug info page boots with system table', async ({ page, baseUrl }) => {
		await page.route('**/api/parts/shells:debug_info/system_info', route => route.fulfill({ json: {
			os: { platform: 'test', release: '1', arch: 'x64' },
			cpu: { model: 'test', cores: 1, speed: 1 },
			memory: { total: 1, free: 0 },
			connectivity: [{ id: 'fount-network', name: 'fount Network', status: 'ok', activeLinks: 2 }],
		} }))
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#copy-button')).toBeVisible()
		await expect(page.locator('h1[data-i18n="debug_info.heading"]')).toBeVisible()
		await expect(page.locator('.page-status')).toHaveCount(0)
		const systemTable = page.locator('#system-info-table')
		await expect(systemTable).toBeVisible()
		await expect(systemTable.locator('tr').first()).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('[data-i18n="debug_info.linksCount"][data-count="2"]')).toBeVisible()
	})

	test('embedded console accepts input and displays the evaluation result', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })
		const frame = page.frameLocator('.debug-log-frame')
		const input = frame.locator('#repl-input')
		await expect(input).toBeVisible({ timeout: 30_000 })
		expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME')
		await input.fill('61000 + 234')
		await input.press('Enter')
		await expect(frame.locator('#backend-log-list')).toContainText('61234', { timeout: 30_000 })
		await expect(input).toHaveValue('')
		const bounds = await input.boundingBox()
		const frameBounds = await page.locator('.debug-log-frame').boundingBox()
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height)
	})

	test('backend collects a second real sample promptly and handles missing latency', async ({ page, baseUrl }) => {
		let probes = 0
		await page.route('**/api/parts/shells:debug_info/system_info', route => {
			probes++
			return route.fulfill({ json: {
				os: { platform: 'test', release: '1', arch: 'x64' },
				cpu: { model: 'test', cores: 1, speed: 1 },
				memory: { total: 100, free: 50 },
				connectivity: [
					{ id: 'sample-service', name: 'npm Registry', status: 'ok', duration: probes * 20 },
					{ id: 'no-rtt', name: 'fount Network', status: 'ok', duration: null },
				],
			} })
		})
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#sample-service .latency-value')).toHaveText('20ms', { timeout: 30_000 })
		await expect(page.locator('#no-rtt .latency-value')).toHaveText('—')
		await expect(page.locator('#sample-service .latency-value')).toHaveText('40ms', { timeout: 20_000 })
		expect(probes).toBe(2)
		// Two genuine measurements must draw a line, rather than waiting for a third.
		const paintedColumns = await page.locator('#sample-service canvas').evaluate(canvas => {
			const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
			const columns = new Set()
			for (let y = 0; y < canvas.height; y++)
				for (let x = 0; x < canvas.width; x++)
					if (data[(y * canvas.width + x) * 4 + 3]) columns.add(x)
			return columns.size
		})
		expect(paintedColumns).toBeGreaterThan(10)
		const themeResults = await page.evaluate(() => {
			const root = document.documentElement
			const originalTheme = root.dataset.theme
			const probe = document.createElement('span')
			document.body.append(probe)
			/**
			 * 通过浏览器解析主题颜色变量。
			 * @param {string} color 主题变量名。
			 * @returns {string} 计算后的颜色。
			 */
			const resolve = color => {
				probe.style.color = `var(${color})`
				return getComputedStyle(probe).color
			}
			const results = ['light', 'dark', 'cyberpunk'].map(theme => {
				root.dataset.theme = theme
				const canvas = document.querySelector('#sample-service canvas')
				const badge = document.querySelector('#sample-service .status-badge')
				return {
					canvas: getComputedStyle(canvas).color === resolve('--color-success'),
					badge: getComputedStyle(badge).color === resolve('--color-success-content'),
					background: getComputedStyle(document.body).backgroundColor === resolve('--color-base-200'),
				}
			})
			if (originalTheme === undefined) delete root.dataset.theme
			else root.dataset.theme = originalTheme
			probe.remove()
			return results
		})
		for (const result of themeResults) expect(result).toEqual({ canvas: true, badge: true, background: true })
		// Repeated focus notifications must share an in-flight probe.
		await page.evaluate(() => {
			for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('visibilitychange'))
		})
		await expect(page.locator('#sample-service .latency-value')).toHaveText('60ms')
		expect(probes).toBe(3)
	})
})
