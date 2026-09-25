/**
 * code shell 前端 UI 测试：标签页草稿 / 会话转换、右键批量关闭、草稿持久化。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { API_BASE, holdLocale, leftoverWorkspaceDirs, openCode, releaseLocale, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test.describe('code shell tabs', () => {
	test('tabs: draft → session conversion, switching, closing, and home menu opening', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-tabs-'))
		leftoverWorkspaceDirs.add(dir)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
			// 执行 shell 命令 → 草稿落盘转为会话标签（标题未命名会话）
			await page.locator('#composer-input').click()
			await page.keyboard.type('！echo tab-lifecycle')
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.role-tool')).toContainText('tab-lifecycle')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// 会话标签带工作区头像（非草稿铅笔图标）
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-avatar:not(.code-tab-avatar-draft)')).toBeVisible()
			// + 新建草稿标签
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
			// 新草稿绑定同一工作区，且为空态布局
			await expect(page.locator('.code-main')).toHaveClass(/empty-mode/)
			// 点会话标签切回（消息流恢复）
			await page.locator('#tab-strip .code-tab', { hasText: '未命名会话' }).click()
			await expect(page.locator('.code-message.role-tool')).toContainText('tab-lifecycle')
			await expect(page.locator('.code-main')).not.toHaveClass(/empty-mode/)
			// home 总览弹窗右栏列出该会话，点击打开（已开 → 聚焦）
			await page.locator('#home-toggle').click()
			const homeSession = page.locator('#home-session-list .code-home-row', { hasText: '未命名会话' })
			await expect(homeSession).toBeVisible()
			await homeSession.locator('.code-home-row-main').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			// 关闭当前活动草稿标签 → 切回相邻会话标签
			await page.locator('#tab-strip .code-tab', { hasText: '新会话' }).locator('.code-tab-close').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// Alt+T 新建 / Alt+1 切换（浏览器保留键无法拦截，键绑用 Alt 系）
			await page.keyboard.press('Alt+t')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await page.keyboard.press('Alt+1')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('未命名会话')
			// 右键会话标签 → 删除对话（确认后关闭标签并从磁盘移除）
			await holdLocale(page)
			try {
				await page.locator('#tab-strip .code-tab', { hasText: '未命名会话' }).click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.sessions.delete"]').click()
				await page.locator('[data-dialog-resolve="ok"]').click()
			}
			finally {
				await releaseLocale(page)
			}
			await expect(page.locator('#tab-strip .code-tab', { hasText: '未命名会话' })).toHaveCount(0)
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})

	test('tab right-click menu closes the tab and batches (left / others / all)', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-tabmenu-'))
		leftoverWorkspaceDirs.add(dir)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			// 建 4 个草稿标签
			for (let i = 0; i < 3; i++) await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(4)
			await holdLocale(page)
			try {
				const tabs = page.locator('#tab-strip .code-tab')
				// 右键第 2 个标签 → 菜单出现
				await tabs.nth(1).click({ button: 'right' })
				await expect(page.locator('#code-tab-menu')).toBeVisible()
				// 关闭左侧 → 3 个
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.left"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(3)
				// 关闭其他（右键首个）→ 1 个
				await page.locator('#tab-strip .code-tab').first().click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.others"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				// 关闭全部 → 回落为一个新草稿（草稿图标，语言无关）
				await page.locator('#tab-strip .code-tab').first().click({ button: 'right' })
				await page.locator('#code-tab-menu [data-i18n="code.tabs.closeMenu.all"]').click()
				await expect(page.locator('#tab-strip .code-tab')).toHaveCount(1)
				await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-avatar-draft')).toBeVisible()
			}
			finally {
				await releaseLocale(page)
			}
		}
		finally {
			await rmDirRetry(dir)
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('unsent drafts persist per-tab and across reload (backend tabs)', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-draft-'))
		leftoverWorkspaceDirs.add(dir)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('draft A')
			// 第二个草稿标签 + 不同的未发送内容
			await page.locator('#new-tab-button').click()
			await page.locator('#composer-input').click()
			await page.keyboard.type('draft B')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			// 等后端防抖落盘：轮询 /tabs 直到两个草稿标签且第二个 draft 为 'draft B'
			await expect(async () => {
				const tabsData = await (await page.request.get(`${baseUrl}${API_BASE}/tabs`)).json()
				expect(tabsData.tabs).toHaveLength(2)
				expect(tabsData.tabs[1].draft).toBe('draft B')
			}).toPass()
			await page.reload({ waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(composer).toContainText('draft B')
			// 切回第一个草稿标签，其未发送内容恢复为 A
			await page.locator('#tab-strip .code-tab').first().click()
			await expect(composer).toContainText('draft A')
			// 清理：移除工作区，避免污染同相位后续测试
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
		finally {
			await rmDirRetry(dir)
		}
	})
})
