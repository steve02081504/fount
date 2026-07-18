/**
 * 【文件】public/src/ui/mdRevealButton.mjs
 * 【职责】不可信 Markdown「点击揭示」按钮挂载（离屏安全 UX）。
 * 【原理】appendTemplate 挂载 `hub/messages/md_reveal_button`，不覆盖气泡已有预览内容。
 * 【关联】groupMode.mjs、template.mjs。
 */
import { appendTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'

/** @type {boolean} */
let templatesReady = false

/** @returns {void} */
function ensureTemplates() {
	if (templatesReady) return
	usingTemplates('/parts/shells:chat/src/templates')
	templatesReady = true
}

/**
 * 在消息气泡内挂载「显示远程 Markdown」按钮（追加，不清空正文）。
 * @param {HTMLElement} parent 气泡容器
 * @param {() => void} onClick 点击后回调
 * @returns {Promise<HTMLElement>} 按钮元素
 */
export async function mountMdRevealButton(parent, onClick) {
	ensureTemplates()
	const existing = parent.querySelector('.markdown-reveal-button')
	if (existing instanceof HTMLElement) {
		if (!existing.dataset.revealWired) {
			existing.dataset.revealWired = '1'
			existing.addEventListener('click', (clickEvent) => {
				clickEvent.stopPropagation()
				onClick?.()
			})
		}
		return existing
	}
	await appendTemplate(parent, 'hub/messages/md_reveal_button', {})
	const button = parent.querySelector('.markdown-reveal-button')
	if (!(button instanceof HTMLElement))
		throw new Error('md reveal button missing')
	button.dataset.revealWired = '1'
	button.addEventListener('click', (clickEvent) => {
		clickEvent.stopPropagation()
		onClick?.()
	})
	return button
}
