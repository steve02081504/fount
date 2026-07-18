/**
 * 【文件】public/hub/composerReply.mjs
 * 【职责】内联 quote-reply 目标状态与输入框上方横幅。
 */

/** @type {{ eventId: string, senderName: string, preview: string } | null} */
let replyTarget = null

/**
 * @returns {{ eventId: string, senderName: string, preview: string } | null} 当前引用目标
 */
export function getReplyTarget() {
	return replyTarget
}

/**
 * 清空引用目标并隐藏横幅。
 * @returns {void}
 */
export function clearReplyTarget() {
	replyTarget = null
	const banner = document.getElementById('hub-reply-banner')
	if (banner) banner.hidden = true
}

/**
 * 设置引用目标并刷新横幅。
 * @param {{ eventId: string, senderName?: string, preview?: string }} target 目标
 * @returns {void}
 */
export function setReplyTarget(target) {
	const eventId = String(target?.eventId || '').trim().toLowerCase()
	if (!/^[0-9a-f]{64}$/.test(eventId)) return
	replyTarget = {
		eventId,
		senderName: String(target.senderName || '').trim().slice(0, 100) || '…',
		preview: String(target.preview || '').replace(/\s+/g, ' ').trim().slice(0, 120) || '…',
	}
	renderReplyBanner()
	const input = document.getElementById('hub-message-input')
	if (input instanceof HTMLTextAreaElement) 
		input.focus()
	
}

/** @returns {void} */
function renderReplyBanner() {
	const banner = document.getElementById('hub-reply-banner')
	if (!banner || !replyTarget) return
	const authorEl = banner.querySelector('[data-reply-author]')
	const previewEl = banner.querySelector('[data-reply-preview]')
	if (authorEl) authorEl.textContent = replyTarget.senderName
	if (previewEl) previewEl.textContent = replyTarget.preview
	banner.hidden = false
}

/**
 * 绑定横幅关闭按钮（幂等）。
 * @returns {void}
 */
export function wireReplyBanner() {
	const banner = document.getElementById('hub-reply-banner')
	if (!(banner instanceof HTMLElement) || banner.dataset.wired === '1') return
	banner.dataset.wired = '1'
	banner.querySelector('[data-reply-clear]')?.addEventListener('click', () => clearReplyTarget())
}
