import { test, expect } from './fixtures.mjs'
import { leftoverWorkspaceDirs, makeWorkspace, openCode, PREF_PREFIX, removeAllWorkspacesViaApi, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test('statistics preserve open details and show provider counts separately from context estimates', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const root = document.createElement('div')
		root.id = 'code-statistics'
		document.body.appendChild(root)
		const { store } = await import('/parts/shells:code/src/store.mjs')
		const { refreshStatistics, createWorkClock } = await import('/parts/shells:code/src/statistics.mjs')
		store.session = {
			usage: { calls: [{ inputTokens: 1000, cacheReadTokens: 800 }], total: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 20, reasoningTokens: 10 } },
			statistics: { runs: [{ runId: 'one', calls: [{ startedAt: 1000, firstOutputAt: 1500, finishedAt: 2500, outputTokens: 100 }], context: { total: 1000, limit: 10000, estimated: false, components: { system: 100, tools: 200, messages: 600, other: 100 } } }] },
		}
		refreshStatistics()
		const details = root.querySelector('details')
		details.open = true
		refreshStatistics()
		const result = { text: root.textContent, open: details.open, clock: createWorkClock({ startedAt: 1000, finishedAt: 57000 }).textContent }
		store.session = { entries: [] }
		refreshStatistics()
		result.unmeteredVisible = !root.hidden
		result.unmeteredText = root.textContent
		store.session = null
		refreshStatistics()
		result.hidden = root.hidden
		return result
	})
	expect(result.text).toContain('1 轮 1 步')
	expect(result.text).toContain('80%')
	expect(result.text).toContain('10%')
	expect(result.text).toContain('~100')
	expect(result.text).not.toContain('${')
	expect(result.open).toBe(true)
	expect(result.hidden).toBe(true)
	expect(result.unmeteredVisible).toBe(true)
	expect(result.unmeteredText).toContain('— 轮 — 步')
	expect(result.clock).toBe('用时 0分56秒')
})

test('run clock survives reload and persists its terminal interval', async ({ page, baseUrl }, testInfo) => {
	const dir = makeWorkspace('statistics', {})
	leftoverWorkspaceDirs.add(dir)
	await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
	try {
		await openCode(page, baseUrl)
		await selectWorkspaceViaBrowser(page, dir)
		await page.locator('#composer-input').click()
		await page.keyboard.type('贴底测试')
		await page.keyboard.press('Control+Enter')
		await expect(page.locator('.generating .code-work-clock')).toContainText('工作中', { timeout: 30000 })
		const startedAt = await page.locator('.generating .code-work-clock').getAttribute('data-started-at')
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(page.locator('.code-work-clock')).toHaveCount(1, { timeout: 30000 })
		await expect(page.locator('.code-work-clock')).toHaveAttribute('data-started-at', startedAt)
		await expect(page.locator('.code-message.generating')).toHaveCount(0, { timeout: 60000 })
		await expect(page.locator('.code-work-clock')).toContainText('用时')
		const finishedAt = await page.locator('.code-work-clock').getAttribute('data-finished-at')
		expect(Number(finishedAt)).toBeGreaterThan(Number(startedAt))
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(page.locator('.code-work-clock')).toHaveAttribute('data-finished-at', finishedAt)
		await expect(page.locator('#code-statistics')).toContainText('1 轮')
		await page.locator('#code-statistics summary').first().click()
		await page.screenshot({ path: testInfo.outputPath('statistics-desktop.png') })
		await page.setViewportSize({ width: 390, height: 844 })
		const panel = await page.locator('#code-statistics details[open] .code-statistic-panel').boundingBox()
		expect(panel.x).toBeGreaterThanOrEqual(0)
		expect(panel.x + panel.width).toBeLessThanOrEqual(390)
		await page.screenshot({ path: testInfo.outputPath('statistics-mobile.png') })
	}
	finally { await removeAllWorkspacesViaApi(page, baseUrl) }
})
