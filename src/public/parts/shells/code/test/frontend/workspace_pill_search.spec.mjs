/**
 * code shell 前端 UI 测试：工作区下拉的常用排序与搜索过滤。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, holdLocale, leftoverWorkspaceDirs, makeWorkspace, openCode, releaseLocale, removeAllWorkspacesViaApi, rmDirRetry, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test.describe('code shell workspace pill search & usage order', () => {
	test('workspace dropdown sorts by recent usage and filters by search', async ({ page, baseUrl }) => {
		const alphaDir = makeWorkspace('fe-use-alpha', {})
		const betaDir = makeWorkspace('fe-use-beta', {})
		const gammaDir = makeWorkspace('fe-use-gamma', {})
		leftoverWorkspaceDirs.add(alphaDir)
		leftoverWorkspaceDirs.add(betaDir)
		leftoverWorkspaceDirs.add(gammaDir)
		try {
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'alpha', machine: '0', path: alphaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'beta', machine: '0', path: betaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'gamma', machine: '0', path: gammaDir } })
			// 按使用时间标记：gamma 最近、beta 次之、alpha 最久（间隔拉开毫秒级保证顺序稳定）
			for (const name of ['alpha', 'beta', 'gamma']) {
				const { list } = await (await page.request.get(`${baseUrl}${API_BASE}/workspaces`)).json()
				const id = list.find(workspace => workspace.name === name).id
				await page.request.put(`${baseUrl}${API_BASE}/workspaces/${id}/use`)
				await new Promise(resolve => setTimeout(resolve, 40))
			}
			await openCode(page, baseUrl)
			await holdLocale(page)
			try {
				await page.locator('#workspace-pill').click()
				const items = page.locator('#workspace-menu .menu-item', { hasText: /alpha|beta|gamma/ })
				await expect(items).toHaveCount(3)
				// 常用程度排序：gamma（最近）→ beta → alpha
				const order = await items.allTextContents()
				expect(order[0]).toContain('gamma')
				expect(order[1]).toContain('beta')
				expect(order[2]).toContain('alpha')
				// 搜索过滤：仅剩 beta
				await page.locator('#workspace-menu input').fill('beta')
				await expect(page.locator('#workspace-menu .menu-item', { hasText: /alpha|beta|gamma/ })).toHaveCount(1)
				await expect(page.locator('#workspace-menu .menu-item', { hasText: 'beta' })).toBeVisible()
			}
			finally {
				await releaseLocale(page)
			}
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(alphaDir)
			await rmDirRetry(betaDir)
			await rmDirRetry(gammaDir)
		}
	})
})
