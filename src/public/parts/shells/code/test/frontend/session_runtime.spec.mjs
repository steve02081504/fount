/**
 * code shell 前端测试：按会话运行时的并发生成、后台预览缓存、停止隔离与完成后未读点。
 */
import { test, expect } from './fixtures.mjs'
import { leftoverWorkspaceDirs, makeWorkspace, openCode, PREF_PREFIX, removeAllWorkspacesViaApi, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)


/** 长流式触发词（36 段 × 150ms，便于观察后台生成与停止隔离）。 */
const LONG_TRIGGER = '贴底测试'
/** 长流式的末段文本。 */
const LAST_SEGMENT = '第 36 段'
/** 送入生成与等待生成的超时。 */
const START_TIMEOUT = 30_000
/** 等待整轮完成的超时。 */
const DONE_TIMEOUT = 60_000

test.describe('code shell session runtime', () => {
	test('two tabs generate concurrently; a new tab keeps the send button; stopping one leaves the other running', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-runtime-concurrent', {})
		leftoverWorkspaceDirs.add(dir)
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			// tab1 开始长流式生成
			await page.locator('#composer-input').click()
			await page.keyboard.type(LONG_TRIGGER)
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.generating')).toHaveCount(1, { timeout: START_TIMEOUT })
			const tab1Key = await page.locator('#tab-strip .code-tab[data-active="true"]').getAttribute('data-tab-key')
			// 新标签（tab2）激活，tab1 退为后台生成
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
			await expect(page.locator('#tab-strip .code-tab[data-active="true"]')).not.toHaveAttribute('data-tab-key', tab1Key)
			// 新标签显示发送按钮（而非停止），即使 tab1 仍在生成
			const sendState = await page.evaluate(async () => {
				const { getActiveRuntime } = await import('/parts/shells:code/src/store.mjs')
				return { status: getActiveRuntime()?.status, stop: document.getElementById('send-button').classList.contains('btn-error') }
			})
			expect(sendState.status).toBe('idle')
			expect(sendState.stop).toBe(false)
			await expect(page.locator(`#tab-strip .code-tab[data-tab-key="${tab1Key}"] .code-tab-generating`)).toHaveCount(1)
			// tab2 也能开始生成
			await page.locator('#composer-input').click()
			await page.keyboard.type(LONG_TRIGGER)
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.generating')).toHaveCount(1, { timeout: START_TIMEOUT })
			// tab1 仍在后台生成
			await expect(page.locator(`#tab-strip .code-tab[data-tab-key="${tab1Key}"] .code-tab-generating`)).toHaveCount(1)
			// 停止 tab2（活动标签）
			await page.locator('#send-button').click()
			await expect(page.locator('.code-message.generating')).toHaveCount(0, { timeout: START_TIMEOUT })
			// 切回 tab1：未被 tab2 的停止影响，仍能跑完整轮得到最终回复
			await page.locator(`#tab-strip .code-tab[data-tab-key="${tab1Key}"]`).click()
			await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText(LAST_SEGMENT, { timeout: DONE_TIMEOUT })
			await expect(page.locator('.code-message.generating')).toHaveCount(0, { timeout: DONE_TIMEOUT })
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('a background tab keeps streaming preview and rebuilds it on return', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-runtime-background', {})
		leftoverWorkspaceDirs.add(dir)
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'streamAgent'), PREF_PREFIX)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type(LONG_TRIGGER)
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.generating .code-message-body')).toContainText('第 1 段', { timeout: START_TIMEOUT })
			const tab1Key = await page.locator('#tab-strip .code-tab[data-active="true"]').getAttribute('data-tab-key')
			// 切到新标签：后台继续接收预览但不渲染
			await page.locator('#new-tab-button').click()
			await expect(page.locator('.code-message.generating')).toHaveCount(0)
			await expect.poll(async () => page.evaluate(async () => {
				const { store } = await import('/parts/shells:code/src/store.mjs')
				for (const runtime of store.runtimes.values())
					if (runtime.status === 'generating') return runtime.previewText
				return ''
			}), { timeout: START_TIMEOUT }).toContain('第 3 段')
			// 切回 tab1：从运行时缓存重建流式气泡
			await page.locator(`#tab-strip .code-tab[data-tab-key="${tab1Key}"]`).click()
			await expect(page.locator('.code-message.generating .code-message-body')).toContainText('第 3 段')
			await expect(page.locator('.code-message.role-char:not(.generating)')).toContainText(LAST_SEGMENT, { timeout: DONE_TIMEOUT })
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})

	test('a background completion sets an unread dot, cleared on activation', async ({ page, baseUrl }) => {
		const dir = makeWorkspace('fe-runtime-unread', {})
		leftoverWorkspaceDirs.add(dir)
		await page.addInitScript(pref => localStorage.setItem(pref + 'charname', 'codeBuddy'), PREF_PREFIX)
		try {
			await openCode(page, baseUrl)
			await selectWorkspaceViaBrowser(page, dir)
			await page.locator('#composer-input').click()
			await page.keyboard.type('你好')
			await page.keyboard.press('Control+Enter')
			await expect(page.locator('.code-message.role-char')).toContainText('测试回复。', { timeout: DONE_TIMEOUT })
			await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBeTruthy()
			const sessionId = new URL(page.url()).searchParams.get('session')
			// 新草稿标签使会话标签成为后台
			await page.locator('#new-tab-button').click()
			await expect(page.locator('#tab-strip .code-tab-unread')).toHaveCount(0)
			// 模拟 code-run-settled：完成后设置未读点
			await page.evaluate(async id => {
				const { handleRunSettled } = await import('/parts/shells:code/src/completion.mjs')
				await handleRunSettled({ sessionId: id, runId: 'session-runtime-test-run', status: 'done' })
			}, sessionId)
			await expect(page.locator('#tab-strip .code-tab-unread')).toHaveCount(1)
			// 激活会话标签清除未读
			await page.locator('#tab-strip .code-tab', { has: page.locator('.code-tab-unread') }).click()
			await expect(page.locator('#tab-strip .code-tab-unread')).toHaveCount(0)
		}
		finally {
			await removeAllWorkspacesViaApi(page, baseUrl)
		}
	})
})
