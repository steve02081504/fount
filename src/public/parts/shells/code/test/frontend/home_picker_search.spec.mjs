/**
 * code shell 前端 UI 测试：home 总览搜索过滤工作区与会话。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, leftoverWorkspaceDirs, makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test.describe('code shell home picker search', () => {
	test('home picker filters workspaces and sessions by search term', async ({ page, baseUrl }) => {
		const alphaDir = makeWorkspace('fe-search-alpha', {})
		const betaDir = makeWorkspace('fe-search-beta', {})
		leftoverWorkspaceDirs.add(alphaDir)
		leftoverWorkspaceDirs.add(betaDir)
		try {
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'alpha', machine: '0', path: alphaDir } })
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'beta', machine: '0', path: betaDir } })
			const now = new Date().toISOString()
			await page.request.post(`${baseUrl}${API_BASE}/sessions`, { data: { machine: '0', workdir: alphaDir, session: { id: 'alpha-session', title: 'alpha 会话', charname: 'codeBuddy', profile: 'build', created: now, updated: now, memory: {}, entries: [] } } })
			await openCode(page, baseUrl)
			await page.locator('#home-toggle').click()
			const search = page.locator('#home-search')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(2)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			// 搜索工作区名 beta → 左栏仅剩匹配项，右栏自动切到该工作区（无会话 → 空态）
			await search.fill('beta')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-workspace-list')).toContainText('beta')
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(0)
			// 搜索工作区名 alpha → 右栏列出其会话
			await search.fill('alpha')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			await expect(page.locator('#home-session-list')).toContainText('alpha 会话')
			// 清空搜索 → 全部恢复
			await search.fill('')
			await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(2)
			await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(1)
			await page.keyboard.press('Escape')
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(alphaDir)
			await rmDirRetry(betaDir)
		}
	})
})
