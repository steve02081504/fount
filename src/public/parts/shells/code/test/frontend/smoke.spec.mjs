/**
 * code shell 页面冒烟：加载、pill 选择器、空态引导与 shell 模式。
 */
import { test, expect } from './fixtures.mjs'

/**
 * 打开 code shell 页面并等待 boot 完成（boot 末步聚焦 composer）。
 * 标签页从后端异步恢复，boot 完成前点击 pill 会与重渲染竞态。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @param {string} baseUrl - 测试节点 base URL。
 * @returns {Promise<void>}
 */
async function openCodeSmoke(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:code/`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => document.querySelector('#composer-input')?.contentEditable === 'true')
	await page.waitForFunction(() => document.activeElement?.id === 'composer-input')
}

/**
 * 挂起 page watch 的 locale 轮换（每秒整页重建与下拉点击竞态，flake 源）。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
async function holdLocale(page) {
	await page.evaluate(() => globalThis.fount?.test?.watch?.holdLocale?.())
}

/**
 * 恢复 locale 轮换。
 * @param {import('npm:@playwright/test').Page} page - Playwright page。
 * @returns {Promise<void>}
 */
async function releaseLocale(page) {
	await page.evaluate(() => globalThis.fount?.test?.watch?.releaseLocale?.())
}

test.describe('code shell smoke', () => {
	test('page boots with pills, draft tab, and centered empty-state guidance', async ({ page, baseUrl }) => {
		await openCodeSmoke(page, baseUrl)
		await holdLocale(page)
		await expect(page.locator('h1')).toHaveCount(1)
		await expect(page.locator('#machine-pill-label')).toHaveAttribute('data-i18n', 'code.machine.local')
		await expect(page.locator('#workspace-pill-label')).toHaveAttribute('data-i18n', 'code.workspaces.none')
		await expect(page.locator('#ai-source-pill-label')).toHaveAttribute('data-i18n', 'code.aiSource.charOwn')
		await expect(page.locator('#mode-pill-label')).toContainText('build')
		await expect(page.locator('#send-button')).toHaveAttribute('aria-label', '发送消息')
		await expect(page.locator('#send-button svg#send-icon')).toBeVisible()
		// 空态：居中布局 + wordmark，无工作区引导走下方 workspace pill
		await expect(page.locator('.code-main')).toHaveClass(/empty-mode/)
		await expect(page.locator('#code-wordmark')).toBeVisible()
		// 启动即有一个活动草稿标签
		await expect(page.locator('#tab-strip .code-tab[data-active="true"] .code-tab-title')).toContainText('新会话')
		await releaseLocale(page)
	})

	test('empty state opens folder browser dialog via the workspace pill', async ({ page, baseUrl }) => {
		await openCodeSmoke(page, baseUrl)
		await holdLocale(page)
		await page.locator('#workspace-pill').click()
		await page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]').click()
		await expect(page.locator('dialog.modal:has(#folder-entries)')).toBeVisible()
		await expect(page.locator('#folder-path-input')).toBeVisible()
		await releaseLocale(page)
	})

	test('typing ！ switches to shell mode', async ({ page, baseUrl }) => {
		await openCodeSmoke(page, baseUrl)
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('！')
		await expect(page.locator('#shell-pill-wrap')).toBeVisible()
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-pill-wrap')).toBeHidden()
	})

	test('builds a spinning sub-agent card from a tool entry', async ({ modulePage }) => {
		const card = await modulePage.run(async () => {
			const { subAgentCardElement } = await import('/parts/shells:code/src/subagents.mjs')
			const element = subAgentCardElement({
				id: 'entry-1',
				role: 'tool',
				name: 'sub-agent',
				extension: { subAgent: { runId: 'run-1', isAsync: true, task: 'do a thing' } },
			})
			return {
				tag: element.tagName,
				runId: element.dataset.subagentRunId,
				working: element.classList.contains('is-working'),
				label: element.querySelector('.code-run-card-label')?.textContent,
				hasIcon: !!element.querySelector('.code-run-card-icon img, .code-run-card-icon svg'),
			}
		})
		expect(card.tag).toBe('BUTTON')
		expect(card.runId).toBe('run-1')
		expect(card.working).toBe(true)
		expect(card.label).toBe('do a thing')
		expect(card.hasIcon).toBe(true)
	})

	test('workspace / machine dropdown menus render', async ({ page, baseUrl }) => {
		await openCodeSmoke(page, baseUrl)
		await holdLocale(page)
		await page.locator('#workspace-pill').click()
		await expect(page.locator('#workspace-menu')).toBeVisible()
		await expect(page.locator('#workspace-menu').locator('[data-i18n="code.workspaces.browse"]')).toBeVisible()
		// 收起 workspace 下拉再开 machine：daisyUI 焦点下拉互切存在竞态
		await page.mouse.click(10, 300)
		await expect(page.locator('#workspace-menu')).toBeHidden()
		await page.locator('#machine-pill').click()
		await expect(page.locator('#machine-menu')).toBeVisible()
		await releaseLocale(page)
	})
})
