/**
 * Proxy shell 前端 smoke：页面可加载、API URL 与密钥区经模板渲染。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Proxy shell smoke', () => {
	test('proxy page boots with API URL and key section', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:proxy/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#proxyApiUrl')).toBeVisible()
		await expect(page.locator('#proxyApiUrl')).not.toHaveValue('')
		await expect(page.locator('#copyProxyButton')).toBeVisible()
		const apiKeySection = page.locator('#apiKeySection')
		await expect(apiKeySection).toBeVisible()
		await expect(apiKeySection.locator(':scope > *').first()).toBeVisible({ timeout: 30_000 })
	})
})
