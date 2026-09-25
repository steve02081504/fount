/**
 * code shell 前端 UI 测试：slash 命令面板与 Enter 换行。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, leftoverWorkspaceDirs, makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

/**
 * 读取 composer 的可视高度（px），用于断言换行是否真的撑出一行。
 * @param {import('npm:@playwright/test').Locator} composer - composer 定位器。
 * @returns {Promise<number>} 元素高度（px）。
 */
const composerHeight = composer => composer.evaluate(el => el.getBoundingClientRect().height)

test.describe('code shell composer keyboard handling', () => {
	test('slash command panel lists workspace commands right after boot into a saved workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-slash', { '.agents/commands/test-cmd.md': '---\ndescription: 测试命令\n---\n渲染内容' })
		leftoverWorkspaceDirs.add(dir)
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

	test('one Enter press after typing a sentence inserts exactly one visible newline', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('hello world')
		const before = await composerHeight(composer)
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n')
		// 一次回车就要撑出一行空行（而不是只改 value，视觉上仍是一行）
		const afterOne = await composerHeight(composer)
		expect(afterOne).toBeGreaterThan(before)
		// 再按一次回车 → 两个换行，再撑高一行（第二次不该吞掉）
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('hello world\n\n')
		expect(await composerHeight(composer)).toBeGreaterThan(afterOne)
	})

	test('one Enter press after pasting text inserts exactly one visible newline', async ({ page, baseUrl, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.evaluate(() => navigator.clipboard.writeText('pasted text'))
		await page.keyboard.press('Control+V')
		await expect(composer).toHaveJSProperty('value', 'pasted text')
		const before = await composerHeight(composer)
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('pasted text\n')
		const afterOne = await composerHeight(composer)
		expect(afterOne).toBeGreaterThan(before)
		await page.keyboard.press('Enter')
		expect(await composer.evaluate(el => el.value)).toBe('pasted text\n\n')
		expect(await composerHeight(composer)).toBeGreaterThan(afterOne)
	})
})
