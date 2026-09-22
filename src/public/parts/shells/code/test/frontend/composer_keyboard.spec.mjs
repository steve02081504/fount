/**
 * code shell 前端 UI 测试：slash 命令面板与 Enter 换行。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry } from './helpers.mjs'

test.describe('code shell composer keyboard handling', () => {
	test('slash command panel lists workspace commands right after boot into a saved workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-slash', { '.agents/commands/test-cmd.md': '---\ndescription: 测试命令\n---\n渲染内容' })
		try {
			// 先保存工作区：boot 会把它选为当前工作区，草稿标签落在其上（不触发工作区切换）
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'slash', machine: '0', path: dir } })
			await openCode(page, baseUrl)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('/test')
			const panel = page.locator('.code-slash-panel')
			await expect(panel).toBeVisible()
			await expect(panel.locator('.code-slash-item')).toHaveCount(1)
			await expect(panel).toContainText('test-cmd')
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('one Enter press after typing a sentence inserts exactly one newline', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('hello world')
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n')
		// 再按一次回车 → 两个换行（第二次不该吞掉）
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n\n')
	})
})
