/**
 * code shell 前端 UI 测试：mode / AI 源 / 角色 pill 下拉。
 */
import { test, expect } from './fixtures.mjs'
import { holdLocale, openCode, PREF_PREFIX, releaseLocale } from './helpers.mjs'

test.describe('code shell pill dropdowns', () => {
	test('mode dropdown opens, lists plan/build, and switching updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		// 挂起 locale 轮换（每秒整页重建与下拉点击竞态）
		await holdLocale(page)
		try {
			await expect(page.locator('#mode-pill-label')).toHaveText('build')
			await page.locator('#mode-pill').click()
			const menu = page.locator('#mode-menu')
			await expect(menu).toBeVisible()
			await expect(menu.locator('.menu-item', { hasText: 'plan' })).toBeVisible()
			await expect(menu.locator('.menu-item', { hasText: 'build' })).toBeVisible()
			await menu.locator('.menu-item', { hasText: 'plan' }).click()
			await expect(page.locator('#mode-pill-label')).toHaveText('plan')
		}
		finally {
			await releaseLocale(page)
		}
	})

	test('Tab in the composer cycles the mode with toast feedback', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await holdLocale(page)
		try {
			await expect(page.locator('#mode-pill-label')).toHaveText('build')
			await page.locator('#composer-input').click()
			await page.keyboard.press('Tab')
			await expect(page.locator('#mode-pill-label')).toHaveText('plan')
			// toast 文案经 data-i18n 随 locale 轮换实时翻译，断言 locale 无关的模式名
			await expect(page.locator('#toast-container')).toContainText('plan')
		}
		finally {
			await releaseLocale(page)
		}
	})

	test('ai source dropdown opens, lists sources, and selecting updates the pill', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await holdLocale(page)
		try {
			// 角色自带是 chrome：按 data-i18n 选，不依赖本地化文本
			await expect(page.locator('#ai-source-pill-label')).toHaveAttribute('data-i18n', 'code.aiSource.charOwn')
			await page.locator('#ai-source-pill').click()
			const menu = page.locator('#ai-source-menu')
			await expect(menu).toBeVisible()
			await expect(menu.locator('.menu-item', { hasText: 'stubAI' })).toBeVisible()
			await expect(menu.locator('[data-i18n="code.aiSource.charOwn"]')).toBeVisible()
			await menu.locator('.menu-item', { hasText: 'stubAI' }).click()
			await expect(page.locator('#ai-source-pill-label')).toHaveText('stubAI')
			// 切回角色自带
			await page.locator('#ai-source-pill').click()
			await expect(page.locator('#ai-source-menu')).toBeVisible()
			await page.locator('#ai-source-menu [data-i18n="code.aiSource.charOwn"]').click()
			await expect(page.locator('#ai-source-pill-label')).toHaveAttribute('data-i18n', 'code.aiSource.charOwn')
		}
		finally {
			await releaseLocale(page)
		}
	})

	test('char switch dialog lists available chars and switching updates the pill', async ({ page, baseUrl }) => {
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		await openCode(page, baseUrl)
		await holdLocale(page)
		try {
			await expect(page.locator('#char-pill-label')).toHaveText('codeBuddy')
			await page.locator('#char-pill').click()
			await expect(page.locator('#char-switch-button')).toBeVisible()
			await page.locator('#char-switch-button').click()
			const dialog = page.locator('dialog.modal:has(#char-switch-list)')
			await expect(dialog).toBeVisible()
			const list = dialog.locator('#char-switch-list')
			await expect(list.locator('.char-option')).toHaveCount(5)
			await expect(list.locator('.char-option', { hasText: 'codeBuddy' })).toBeVisible()
			await expect(list.locator('.char-option', { hasText: 'testAgent' })).toBeVisible()
			await expect(list.locator('.char-option', { hasText: 'streamAgent' })).toBeVisible()
			await expect(list.locator('.char-option', { hasText: 'toolAgent' })).toBeVisible()
			await expect(list.locator('.char-option', { hasText: 'multiRoundAgent' })).toBeVisible()
			await list.locator('.char-option', { hasText: 'testAgent' }).click()
			await expect(dialog).toBeHidden()
			await expect(page.locator('#char-pill-label')).toHaveText('testAgent')
			// 发送一条消息，按回复内容验证切换已生效（testAgent 与 codeBuddy 的回复文案不同）
			const composer = page.locator('#composer-input')
			await composer.click()
			await page.keyboard.type('切换验证')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-user')).toContainText('切换验证', { timeout: 60_000 })
			await expect(page.locator('.code-message.role-char')).toContainText('我是 testAgent，角色切换验证。', { timeout: 60_000 })
		}
		finally {
			await releaseLocale(page)
		}
	})
})
