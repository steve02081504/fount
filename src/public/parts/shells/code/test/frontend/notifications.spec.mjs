/**
 * code shell 前端 UI 测试：非活动会话通知角标与 ?session= 深链恢复。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from './fixtures.mjs'
import { BASE, leftoverWorkspaceDirs, openCode, PREF_PREFIX, removeAllWorkspacesViaApi, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test.describe('code shell notification suppression', () => {
	test('notification marks an inactive session tab, activating clears it, and ?session= restores the session', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-notify-'))
		leftoverWorkspaceDirs.add(dir)
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('通知抑制测试')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
			// 会话标签地址栏带 session 参数
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBeTruthy()
			}).toPass()
			const sessionId = new URL(page.url()).searchParams.get('session')
			/**
			 * 模拟 Service Worker 通知事件。
			 * @param {string} id session id
			 * @returns {Promise<void>} 事件派发完成
			 */
			const dispatchNotification = id => page.evaluate(session => {
				window.dispatchEvent(new CustomEvent('fount-notification', {
					detail: { title: 'x', options: { tag: `code:${session}` }, targetUrl: `/parts/shells:code/?session=${session}`, suppressed: true },
				}))
			}, id)
			// 当前活动标签即通知来源：不显示角标
			await dispatchNotification(sessionId)
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
			// 新建草稿标签 → 会话标签转为非活动，且地址栏不再带 session
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBeNull()
			}).toPass()
			// 非活动会话收到被抑制的通知 → 出现未读红点
			await dispatchNotification(sessionId)
			await expect(page.locator('.code-tab-unread')).toHaveCount(1)
			// 点击该会话标签：角标清除，地址栏切回该会话
			await page.locator('#tab-strip .code-tab', { has: page.locator('.code-tab-unread') }).click()
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
			await expect(async () => {
				expect(new URL(page.url()).searchParams.get('session')).toBe(sessionId)
			}).toPass()
			// 通知点击深链：关闭会话标签后以 ?session= 重开，应从磁盘恢复会话（而非仅命中已开标签）
			const workspaceId = new URL(page.url()).searchParams.get('workspace')
			await page.locator('#tab-strip .code-tab:not(:has(.code-tab-avatar-draft)) .code-tab-close').click()
			await expect(page.locator('#tab-strip .code-tab:not(:has(.code-tab-avatar-draft))')).toHaveCount(0)
			await page.goto(`${baseUrl}${BASE}?workspace=${workspaceId}&session=${sessionId}`, { waitUntil: 'domcontentloaded' })
			await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
			await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
			await expect(page.locator('#tab-strip .code-tab[data-active="true"]')).toHaveCount(1)
			await expect(page.locator('.code-message.role-user')).toContainText('通知抑制测试')
			await expect(page.locator('.code-tab-unread')).toHaveCount(0)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})
})
