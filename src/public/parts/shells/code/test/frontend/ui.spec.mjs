/**
 * code shell 前端 UI 测试：placeholder 回归、pill 下拉（mode / AI 源 / 角色）、shell 模式、消息发送与工作区选择。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { test, expect } from './fixtures.mjs'

const BASE = '/parts/shells:code/'
/** 隔离测试用户名（run.mjs testUsername）对应的 localStorage 偏好前缀。 */
const PREF_PREFIX = 'code.shell.code-fe-user.'

/**
 * 打开 code shell 页面并等待 composer 就绪。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
async function openCode(page, baseUrl) {
	await page.goto(`${baseUrl}${BASE}`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
}

test.describe('code shell composer & placeholders', () => {
	test('composer placeholder stays on normal message text after blur and refocus', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toContainText('输入消息开始')
		// 点外部再点回输入框：占位符不应被旧 i18n 文案（输入命令，Enter 执行…）覆盖
		await page.locator('#session-title').click()
		await expect(composer).not.toBeFocused()
		await composer.click()
		await expect(placeholder).toContainText('输入消息开始')
		await expect(placeholder).not.toContainText('输入命令')
	})

	test('shell mode swaps the composer placeholder and restores on clear', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		const placeholder = composer.locator('.fount-markdown-rich-input-placeholder')
		await expect(placeholder).toContainText('输入消息开始')
		await composer.click()
		await page.keyboard.type('！')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		// 内容非空时占位符 span 不渲染
		await expect(placeholder).toHaveCount(0)
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeHidden()
		await expect(placeholder).toContainText('输入消息开始')
		await expect(placeholder).not.toContainText('输入命令')
	})

	test('! shell command executes and renders output bubbles', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('！echo hello-code-shell')
		await page.locator('#send-button').click()
		await expect(page.locator('.code-message.role-user')).toContainText('echo hello-code-shell')
		await expect(page.locator('.code-message.role-tool')).toContainText('hello-code-shell')
	})

	test('Ctrl+Enter sends a message and renders the char reply', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('你好')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.code-message.role-user')).toContainText('你好', { timeout: 60_000 })
		await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: 60_000 })
	})
})

test.describe('code shell pill dropdowns', () => {
	test('mode dropdown opens, lists plan/build, and switching updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#mode-pill-label')).toHaveText('build')
		await page.locator('#mode-pill').click()
		const menu = page.locator('#mode-menu')
		await expect(menu).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'plan' })).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'build' })).toBeVisible()
		await menu.locator('.menu-item', { hasText: 'plan' }).click()
		await expect(page.locator('#mode-pill-label')).toHaveText('plan')
	})

	test('Tab in the composer cycles the mode with toast feedback', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#mode-pill-label')).toHaveText('build')
		await page.locator('#composer-input').click()
		await page.keyboard.press('Tab')
		await expect(page.locator('#mode-pill-label')).toHaveText('plan')
		await expect(page.locator('#toast-container')).toContainText('已切换到 plan 模式')
	})

	test('ai source dropdown opens, lists sources, and selecting updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('#ai-source-pill-label')).toHaveText('角色自带')
		await page.locator('#ai-source-pill').click()
		const menu = page.locator('#ai-source-menu')
		await expect(menu).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: 'stubAI' })).toBeVisible()
		await expect(menu.locator('.menu-item', { hasText: '角色自带' })).toBeVisible()
		await menu.locator('.menu-item', { hasText: 'stubAI' }).click()
		await expect(page.locator('#ai-source-pill-label')).toHaveText('stubAI')
		// 切回角色自带
		await page.locator('#ai-source-pill').click()
		await expect(page.locator('#ai-source-menu')).toBeVisible()
		await page.locator('#ai-source-menu').locator('.menu-item', { hasText: '角色自带' }).click()
		await expect(page.locator('#ai-source-pill-label')).toHaveText('角色自带')
	})

	test('char switch dialog lists available chars and switching updates the pill', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		await expect(page.locator('#char-menu-label')).toHaveText('codeBuddy')
		await page.locator('#char-menu-button').click()
		await expect(page.locator('#char-switch-button')).toBeVisible()
		await page.locator('#char-switch-button').click()
		const dialog = page.locator('dialog.modal:has(#char-switch-list)')
		await expect(dialog).toBeVisible()
		const list = dialog.locator('#char-switch-list')
		await expect(list.locator('.char-option')).toHaveCount(2)
		await expect(list.locator('.char-option', { hasText: 'codeBuddy' })).toBeVisible()
		await expect(list.locator('.char-option', { hasText: 'testAgent' })).toBeVisible()
		await list.locator('.char-option', { hasText: 'testAgent' }).click()
		await expect(dialog).toBeHidden()
		await expect(page.locator('#char-menu-label')).toHaveText('testAgent')
	})
})

test.describe('code shell sessions & workspace', () => {
	test('new session button starts an empty session in the list', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await expect(page.locator('.code-empty-title')).toContainText('选择一个工作区')
		await page.locator('#new-session-button').click()
		await expect(page.locator('.code-session-item')).toHaveCount(1)
		await expect(page.locator('.code-session-item-title')).toContainText('未命名会话')
	})

	test('selecting a workspace via the folder browser enables the coding session flow', async ({ page, baseUrl }) => {
		const dir = mkdtempSync(join(tmpdir(), 'fount-code-fe-'))
		try {
			await openCode(page, baseUrl)
			await page.locator('#workspace-pill').click()
			await expect(page.locator('#workspace-menu')).toBeVisible()
			await page.locator('#workspace-menu').getByText('浏览…').click()
			await expect(page.locator('dialog.modal:has(#folder-entries)')).toBeVisible()
			await page.locator('#folder-path-input').fill(dir)
			await page.locator('#folder-select-button').click()
			await expect(page.locator('#workspace-pill-label')).toContainText(basename(dir))
			await expect(page.locator('.code-empty-title')).toContainText('开始新的编码会话')
			// 清理：移除工作区，避免污染同相位后续测试
			await page.locator('#workspace-pill').click()
			await page.locator('#workspace-menu').getByText('移除当前工作区').click()
			await expect(page.locator('#workspace-pill-label')).toContainText('未选择工作区')
		}
		finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})