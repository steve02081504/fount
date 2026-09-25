/**
 * code shell 前端 UI 测试：文件夹浏览器（根视图 / 路径导航 / 过滤 + 键盘 / 快速访问）。
 * 从 sessions.spec 拆出：这些用例共享「打开浏览器」的开销与 locale 轮换竞态修复路径，
 * 独立成 spec 后可单独触发与复用，不必跑完整的会话 / 工作区用例。
 */
import { basename, dirname, join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { API_BASE, makeWorkspace, openCode, openFolderBrowserViaMenu, removeAllWorkspacesViaApi, rmDirRetry } from './helpers.mjs'

test.describe('code shell folder browser', () => {
	test('lists drive roots on open and lists a directory after navigating by path', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-browse', { 'inner/note.txt': 'hi' })
		try {
			await openCode(page, baseUrl)
			await openFolderBrowserViaMenu(page)
			// 打开即列出根（本机盘符 / unix /）
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 顶部输入路径回车后列出该目录内容
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('inner')
			// 双击目录进入（仅显示文件夹：inner 内只有 note.txt，列表应显示无匹配）
			await page.locator('#folder-entries .folder-browser-entry', { hasText: 'inner' }).dblclick()
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[/\\]+$/, '') + '/inner')
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(0)
			// 选中当前目录（inner）为工作区
			await page.locator('#folder-select-button').click()
			await expect(page.locator('#workspace-pill-label')).toContainText('inner')
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('filters entries and navigates with arrow + enter', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-filter', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
			'gamma/note.txt': 'c',
		})
		try {
			await openCode(page, baseUrl)
			await openFolderBrowserViaMenu(page)
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 导航到 <root>：alpha / beta / gamma 三个子目录
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('beta')
			// 输入过滤词 beta：列表仅剩 beta
			await page.locator('#folder-path-input').fill('beta')
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(1)
			await expect(page.locator('#folder-entries .folder-browser-entry')).toContainText('beta')
			await expect(page.locator('#folder-entries .folder-browser-entry')).not.toContainText('alpha')
			// 方向键移动高亮（单条目时停在首项）→ 回车进入目录
			await page.locator('#folder-path-input').press('ArrowDown')
			await page.locator('#folder-path-input').press('ArrowDown')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toContainText('beta')
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[/\\]+$/, '') + '/beta')
			// 仅显示文件夹：beta 内只有 note.txt 文件，列表应为空态
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(0)
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('treats an edited path as navigation: clears selection and Enter jumps', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-nav', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
		})
		try {
			await openCode(page, baseUrl)
			await openFolderBrowserViaMenu(page)
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 导航到 dir：alpha / beta 两个子目录
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('alpha')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(1)
			// 编辑路径：改为父目录（含分隔符，目录部分偏离当前视图）→ 高亮取消
			const parent = dirname(dir)
			await page.locator('#folder-path-input').fill(parent)
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(0)
			// 方向键不再移动选中
			await page.locator('#folder-path-input').press('ArrowDown')
			await expect(page.locator('#folder-entries .folder-browser-entry.active')).toHaveCount(0)
			// 回车跳转到父目录（列出 dir 自身）
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-path-input')).toHaveValue(parent)
			await expect(page.locator('#folder-entries .folder-browser-entry', { hasText: basename(dir) })).toBeVisible()
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('shows quick access group for the current workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-quick', {
			'current/.git/HEAD': 'ref: refs/heads/main',
			'sibling/note.txt': 'hi',
		})
		try {
			// 后端先保存工作区（boot 会把它选为当前工作区）
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'current', machine: '0', path: join(dir, 'current') } })
			await openCode(page, baseUrl)
			await openFolderBrowserViaMenu(page)
			// 根视图附带快速访问分组（兄弟目录 + 编辑器源）
			await expect(page.locator('.folder-browser-group').first()).toContainText('快速访问')
			await expect(page.locator('#folder-entries .folder-browser-entry', { hasText: 'sibling' })).toBeVisible()
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})
})
