/** 文件浏览器和编辑器共用会话标签栏。 */
import { readFileSync } from 'node:fs'

import { test, expect } from './fixtures.mjs'
import { API_BASE, leftoverWorkspaceDirs, makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test('file tree opens a file tab, previews changes, saves, and returns to the agent tab', async ({ page, baseUrl }) => {
	const dir = makeWorkspace('explorer', { 'src/note.txt': 'first\nsecond\n' })
	leftoverWorkspaceDirs.add(dir)
	try {
		await openCode(page, baseUrl)
		await selectWorkspaceViaBrowser(page, dir)
		await expect(page.locator('#code-explorer-tree .code-tree-row')).toContainText(['src'])
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'src' }).click()
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'note.txt' }).click()
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
		await expect(page.locator('#code-editor')).toBeVisible()
		await expect(page.locator('#code-editor-input')).toHaveValue('first\nsecond\n')
		// 行数由 i18n 文案自己插值（`${count} 行`）：尾随换行也算一行
		await expect(page.locator('#code-editor-status')).toHaveText('3 行')
		await page.locator('#code-editor-input').fill('first\nchanged\n')
		await expect(page.locator('#code-editor-summary')).toContainText('+1')
		await expect(page.locator('#code-editor-summary')).toContainText('−1')
		await page.locator('#code-editor-diff').click()
		await expect(page.locator('#code-editor-diff-view')).toContainText('- second')
		await expect(page.locator('#code-editor-diff-view')).toContainText('+ changed')
		await page.locator('#code-editor-save').click()
		await expect(page.locator('#code-editor-dirty')).toBeHidden()
		expect(readFileSync(`${dir}/src/note.txt`, 'utf8')).toBe('first\nchanged\n')
		await page.locator('#tab-strip .code-tab').first().locator('.code-tab-main').click()
		await expect(page.locator('#code-editor')).toBeHidden()
		await expect(page.locator('#composer-input')).toBeVisible()
		await page.evaluate(async () => {
			const [{ store }, { renderMessages }] = await Promise.all([
				import('/parts/shells:code/src/store.mjs'),
				import('/parts/shells:code/src/messages.mjs'),
			])
			store.session.entries.push({
				id: 'edit-summary',
				role: 'tool',
				name: 'file-operations.replace-file',
				content: '文件 `src/note.txt` 内容已修改。',
				extension: { pluginData: { 'file-operations': { edit: { path: 'src/note.txt', added: 1, removed: 1, diff: '@@ 2 @@\n-second\n+changed' } } } },
			})
			store.session.entries.push({
				id: 'remote-edit-summary', role: 'tool', name: 'file-operations.replace-file', content: 'remote edit',
				extension: {
					executionTarget: { machine: 'unknown-remote-machine', workdir: '/remote/workspace' },
					pluginData: { 'file-operations': { edit: { path: 'src/note.txt', added: 1, removed: 1, diff: '-remote\n+changed' } } },
				},
			})
			renderMessages()
		})
		await expect(page.locator('.code-change-summary')).toContainText('src/note.txt')
		await expect(page.locator('.code-change-summary')).toContainText('+1')
		await expect(page.locator('.code-change-file')).toHaveCount(2)
		await expect(page.locator('.code-change-file').last()).toBeDisabled()
		await page.locator('.code-change-file').first().hover()
		await expect(page.locator('.code-change-preview')).toContainText('-second')
		await expect(page.locator('.code-change-preview')).toContainText('+changed')
		await page.locator('.code-change-file').first().click()
		await expect(page.locator('#code-editor-input')).toHaveValue('first\nchanged\n')
		await expect(async () => {
			const data = await (await page.request.get(`${baseUrl}${API_BASE}/tabs`)).json()
			expect(data.tabs.some(tab => tab.type === 'file' && tab.id === 'src/note.txt')).toBe(true)
		}).toPass()
		await removeAllWorkspacesViaApi(page, baseUrl)
	}
	finally { await rmDirRetry(dir) }
})
