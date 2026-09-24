/**
 * code shell 前端测试：`?prompt=` 冷启动开对话（`fount run code --prompt` 无页面在线时的回退路径）。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, BASE, PREF_PREFIX, holdLocale, leftoverWorkspaceDirs, makeWorkspace, releaseLocale, removeAllWorkspacesViaApi, useLeftoverWorkspaceCleanup } from './helpers.mjs'

/**
 * 经 API 保存一个工作区并返回其 id。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @param {string} dir - 工作区目录。
 * @returns {Promise<string>} 工作区 id。
 */
async function addWorkspace(page, baseUrl, dir) {
	const response = await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'prompt-run', machine: '0', path: dir } })
	const { list } = await response.json()
	return list.find(workspace => workspace.path === dir).id
}

// 会话在页面关闭时 flush 回已删除目录会重建文件句柄，目录交给 afterAll（context teardown 后）清理
useLeftoverWorkspaceCleanup(test)

test.describe('code shell run prompt', () => {
	test('?workspace=&prompt= opens a new conversation and sends the prompt', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fount-code-prompt-', {})
		leftoverWorkspaceDirs.add(dir)
		// 固定角色，避免依赖默认部分；测试节点已复制 codeBuddy fixture
		await page.addInitScript(prefix => localStorage.setItem(`${prefix}charname`, 'codeBuddy'), PREF_PREFIX)
		await page.goto(`${baseUrl}${BASE}`, { waitUntil: 'domcontentloaded' })
		const workspaceId = await addWorkspace(page, baseUrl, dir)
		await page.goto(`${baseUrl}${BASE}?workspace=${encodeURIComponent(workspaceId)}&prompt=${encodeURIComponent('来自 fount run 的提示词')}`, { waitUntil: 'domcontentloaded' })
		await holdLocale(page)
		try {
			// 用户消息乐观插入并回显
			await expect(page.locator('.code-message.role-user', { hasText: '来自 fount run 的提示词' })).toHaveCount(1)
		}
		finally {
			await releaseLocale(page)
		}
		await removeAllWorkspacesViaApi(page, baseUrl)
	})
})
