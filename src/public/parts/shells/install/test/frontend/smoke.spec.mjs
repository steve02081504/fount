/**
 * Install shell 前端 smoke：页面可加载、导入控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Install shell smoke', () => {
	test('import page boots with drop area and tabs', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:install/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#import-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('main#import-content')).toBeVisible()
		await expect(page.locator('#drop-area')).toBeVisible()
		/**
		 * index.mjs（tab 切换监听所在模块）的静态脚本在依赖链（含远端 Sentry）就绪前不会执行，
		 * 通过动态 import 同一 URL 等待其求值完成，再操作 tab 避免竞争。
		 */
		await page.evaluate(() => import('/parts/shells:install/index.mjs'))
		await page.locator('#text-import-tab').click()
		await expect(page.locator('#text-input')).toBeVisible()
		await expect(page.locator('#file-import-content')).toBeHidden()
	})
})
