/**
 * 【文件】public/src/ui/mdRevealBtn.mjs
 * 【职责】不可信 Markdown「点击揭示」按钮挂载（离屏安全 UX）。
 * 【原理】mountMdRevealButton 懒加载模板 profile/md_reveal_btn；onClick 回调由 groupMode 传入。
 * 【数据结构】templatesReady 标志、parent HTMLElement。
 * 【关联】groupMode.mjs、template.mjs。
 */
import { mountTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'

/** @type {boolean} */
let templatesReady = false

/**
 * @returns {void}
 */
function ensureTemplates() {
	if (templatesReady) return
	usingTemplates('/parts/shells:chat/src/templates')
	templatesReady = true
}

/**
 * 在消息气泡内挂载「显示远程 Markdown」按钮。
 * @param {HTMLElement} parent 气泡容器
 * @param {() => void} onClick 点击后回调
 * @returns {Promise<HTMLElement>} 按钮元素
 */
export async function mountMdRevealButton(parent, onClick) {
	ensureTemplates()
	if (parent.querySelector('.hub-markdown-reveal-button')) {
		const existing = parent.querySelector('.hub-markdown-reveal-button')
		return /** @type {HTMLElement} */ existing
	}
	const revealButton = await mountTemplate(parent, 'hub/messages/md_reveal_button', {})
	revealButton.addEventListener('click', (clickEvent) => {
		clickEvent.stopPropagation()
		onClick?.()
	})
	return revealButton
}
