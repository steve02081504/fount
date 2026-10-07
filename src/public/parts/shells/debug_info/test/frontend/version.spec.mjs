/** GitHub compare 状态必须正确决定是否显示更新。 */
import { test, expect } from './fixtures.mjs'

test.describe('debug_info version comparison', () => {
	test('only remote commits missing locally enable update; failed and missing branch comparisons stay unknown', async ({ page, baseUrl }) => {
		const localSha = 'a'.repeat(40)
		let comparison = { status: 'ahead', ahead_by: 2, behind_by: 0 }
		const comparedRefs = []
		await page.route('**/api/ping', route => route.fulfill({ json: { ver: localSha, branch: 'feature/no-upstream' } }))
		await page.route('https://api.github.com/repos/steve02081504/fount/compare/**', route => {
			comparedRefs.push(new URL(route.request().url()).pathname)
			return comparison === null
				? route.fulfill({ status: 404, json: { message: 'Not Found' } })
				: route.fulfill({ json: { ...comparison, base_commit: { sha: 'b'.repeat(40) } } })
		})
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })

		const badge = page.locator('#version-indicator')
		const updateButton = page.locator('#update-button')
		await expect(badge).toHaveAttribute('data-state', 'ok', { timeout: 30_000 })
		await expect(updateButton).toBeDisabled()
		await expect.poll(() => comparedRefs.length).toBeGreaterThan(0)
		expect(comparedRefs.at(-1)).toContain('/feature%2Fno-upstream...')
		expect(comparedRefs.at(-1)).not.toContain('/master...')

		for (const [next, enabled] of [
			[{ status: 'identical', ahead_by: 0, behind_by: 0 }, false],
			[{ status: 'ahead', ahead_by: 3, behind_by: 0 }, false],
			[{ status: 'behind', ahead_by: 0, behind_by: 2 }, true],
			[{ status: 'diverged', ahead_by: 1, behind_by: 2 }, true],
		]) {
			comparison = next
			const previousCount = comparedRefs.length
			await page.reload({ waitUntil: 'domcontentloaded' })
			await expect.poll(() => comparedRefs.length).toBeGreaterThan(previousCount)
			await expect(updateButton).toHaveJSProperty('disabled', !enabled)
			await expect(badge).toHaveAttribute('data-state', enabled ? 'outdated' : 'ok')
		}

		comparison = null
		const previousCount = comparedRefs.length
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(badge).toHaveAttribute('data-state', 'failed')
		await expect(updateButton).toBeDisabled()
		await expect.poll(() => comparedRefs.length).toBeGreaterThan(previousCount)
		expect(comparedRefs.at(-1)).not.toContain('/master...')
	})

	test('update button surfaces the auto-update-disabled notice instead of staying silently disabled', async ({ page, baseUrl }) => {
		// 远端更新可用时按钮才可点击。
		await page.route('https://api.github.com/**', route => route.fulfill({ json: {
			status: 'behind', ahead_by: 0, behind_by: 1, base_commit: { sha: '0'.repeat(40) },
		} }))
		// 自动更新关闭（.noupdate / Docker 镜像）时后端拒绝重启，前端应给出明确提示而非静默失败。
		await page.route('**/api/parts/shells:debug_info/restart', route => route.fulfill({ status: 403, json: { error: 'auto_update_disabled' } }))

		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })

		const updateButton = page.locator('#update-button')
		await expect(updateButton).toBeEnabled({ timeout: 30_000 })
		await updateButton.click()
		await expect(page.locator('#toast-container .alert-warning div[data-i18n="debug_info.autoUpdateNotEnabled"]')).toBeVisible()
		await expect(updateButton).toBeEnabled()
	})
})
