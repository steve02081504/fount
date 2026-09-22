/**
 * code shell 前端 UI 测试：会话选择、工作区选择、文件夹浏览器、工作区角色覆盖与推荐。
 */
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { API_BASE, PREF_PREFIX, holdLocale, makeWorkspace, openCode, releaseLocale, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser } from './helpers.mjs'

test.describe('code shell sessions & workspace', () => {
	test('new tab button opens a new draft tab on each click', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
		await page.locator('#new-tab-button').click()
		// 每次点击都新建草稿标签（允许多个未发送草稿标签并存），而非复用当前空草稿
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
		await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
		await page.locator('#new-tab-button').click()
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(3)
	})

	test('selecting a workspace via the folder browser enables the coding session flow', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-'))
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			// 无会话条目 → 保持空态（wordmark 居中）
			await expect(page.locator('.code-main')).toHaveClass(/empty-mode/)
			// home 总览弹窗：左栏工作区列表含该目录，右栏显示空态
			await page.locator('#home-toggle').click()
			await expect(page.locator('#home-workspace-list')).toContainText(basename(dir))
			await expect(page.locator('#home-session-list')).toContainText('暂无会话')
			await page.keyboard.press('Escape')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('home picker deletes a conversation (file + tab)', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-home-delconv', {})
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo home-delete')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('home-delete')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			const sessionsDir = join(dir, '.fount', 'code', 'sessions')
			/**
			 * 磁盘上该工作区的会话文件。
			 * @returns {string[]} 会话文件名列表。
			 */
			const sessionFiles = () => readdirSync(sessionsDir).filter(name => name.endsWith('.json'))
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(1)
			}).toPass()
			await holdLocale(page)
			try {
				await page.locator('#home-toggle').click()
				await page.locator('#home-session-list .code-home-row', { hasText: '未命名会话' }).locator('.code-home-row-delete').click()
				await page.locator('dialog[open] [data-dialog-resolve="ok"]').click()
				await expect(page.locator('#home-session-list .code-home-row')).toHaveCount(0)
				// 会话标签被关闭 → 回落为单个新草稿
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
			}
			finally {
				await releaseLocale(page)
			}
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(0)
			}).toPass()
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('home picker removes a workspace but keeps its session files on disk', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-home-rmws', {})
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo keep-me')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('keep-me')
			const sessionsDir = join(dir, '.fount', 'code', 'sessions')
			/**
			 * 磁盘上该工作区的会话文件。
			 * @returns {string[]} 会话文件名列表。
			 */
			const sessionFiles = () => readdirSync(sessionsDir).filter(name => name.endsWith('.json'))
			await expect(async () => {
				expect(sessionFiles()).toHaveLength(1)
			}).toPass()
			await holdLocale(page)
			try {
				await page.locator('#home-toggle').click()
				await page.locator('#home-workspace-list .code-home-row', { hasText: basename(dir) }).first().locator('.code-home-row-delete').click()
				await page.locator('dialog[open] [data-dialog-resolve="ok"]').click()
				await expect(page.locator('#home-workspace-list .code-home-row')).toHaveCount(0)
			}
			finally {
				await releaseLocale(page)
			}
			// 仅移除保存条目 → 磁盘会话文件保留
			expect(sessionFiles()).toHaveLength(1)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
			await rmDirRetry(dir)
		}
	})

	test('folder browser lists drive roots on open and lists a directory after navigating by path', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-browse', { 'inner/note.txt': 'hi' })
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			// 打开即列出根（本机盘符 / unix /）
			await expect(page.locator('#folder-entries .folder-browser-entry').first()).toBeVisible()
			// 顶部输入路径回车后列出该目录内容
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-path-input').press('Enter')
			await expect(page.locator('#folder-entries')).toContainText('inner')
			// 双击目录进入（仅显示文件夹：inner 内只有 note.txt，列表应显示无匹配）
			await page.locator('#folder-entries .folder-browser-entry', { hasText: 'inner' }).dblclick()
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[\\/]+$/, '') + '/inner')
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

	test('folder browser filters entries and navigates with arrow + enter', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-filter', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
			'gamma/note.txt': 'c',
		})
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
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
			await expect(page.locator('#folder-path-input')).toHaveValue(dir.replace(/[\\/]+$/, '') + '/beta')
			// 仅显示文件夹：beta 内只有 note.txt 文件，列表应为空态
			await expect(page.locator('#folder-entries .folder-browser-entry')).toHaveCount(0)
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('folder browser treats an edited path as navigation: clears selection and Enter jumps', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-nav', {
			'alpha/note.txt': 'a',
			'beta/note.txt': 'b',
		})
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
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

	test('folder browser shows quick access group for the current workspace', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-quick', {
			'current/.git/HEAD': 'ref: refs/heads/main',
			'sibling/note.txt': 'hi',
		})
		try {
			// 后端先保存工作区（boot 会把它选为当前工作区）
			await page.request.post(`${baseUrl}${API_BASE}/workspaces`, { data: { name: 'current', machine: '0', path: join(dir, 'current') } })
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
			// 根视图附带快速访问分组（兄弟目录 + 编辑器源）
			await expect(page.locator('.folder-browser-group').first()).toContainText('快速访问')
			await expect(page.locator('#folder-entries .folder-browser-entry', { hasText: 'sibling' })).toBeVisible()
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('workspace .agents/fount/code.json overrides the selected character when installed', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-char', { '.agents/fount/code.json': JSON.stringify({ char: { partname: 'codeBuddy' } }) })
		try {
			await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'testAgent'), PREF_PREFIX)
			await openCode(page, baseUrl)
			await expect(page.locator('#char-pill-label')).toHaveText('testAgent')
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('#char-pill-label')).toHaveText('codeBuddy')
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('uninstalled recommended char shows a dismissible bottom-right card', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-rec', { '.agents/fount/code.json': JSON.stringify({ char: { partname: 'GhostCharNotInstalled', install_url: 'x' } }) })
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('.code-char-recommend')).toBeVisible()
			await expect(page.locator('.code-char-recommend-text')).toContainText('GhostCharNotInstalled')
			await page.locator('.code-char-recommend .btn-ghost').click()
			await expect(page.locator('.code-char-recommend')).toBeHidden()
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})
})
