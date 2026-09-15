/**
 * Toast 渲染契约：普通 toast 的文本按纯文本渲染（防注入），
 * custom 通道保留 HTML（后端/插件推送 HTML toast 的既定通道，如成就解锁）。
 */
import { test, expect } from './fixtures.mjs'

test('plain toast renders HTML-looking text as text', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { showToast, getToastContainer } = await import('/scripts/features/toast.mjs')
		const container = getToastContainer()
		container.replaceChildren()
		showToast('info', '<img src="x" onerror="window.__fountToastXss=1"><b class="toast-injected">bold</b>', 0)
		const card = container.querySelector('.alert')
		return {
			injectedImg: !!card.querySelector('img[src="x"]'),
			injectedBold: !!card.querySelector('b.toast-injected'),
			text: card.textContent,
		}
	})
	expect(result.injectedImg).toBe(false)
	expect(result.injectedBold).toBe(false)
	expect(result.text).toContain('<b class="toast-injected">bold</b>')
})

test('custom toast keeps backend HTML', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { showToast, getToastContainer } = await import('/scripts/features/toast.mjs')
		const container = getToastContainer()
		container.replaceChildren()
		showToast('custom', '<a class="achievement-toast" href="/parts/shells:achievements/"><b class="toast-marker">unlocked</b></a>', 0)
		const card = container.firstElementChild
		return {
			hasAnchor: !!card.querySelector('a.achievement-toast'),
			hasMarker: !!card.querySelector('b.toast-marker'),
		}
	})
	expect(result.hasAnchor).toBe(true)
	expect(result.hasMarker).toBe(true)
})
