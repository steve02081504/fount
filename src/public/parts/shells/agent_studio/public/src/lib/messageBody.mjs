/** 可逐条切换 Markdown / 原文的消息正文，使用站点统一的 Markdown 渲染器。 */
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 创建可切换视图的消息正文。
 * @param {string} text 消息文本
 * @returns {HTMLElement} 内容及视图按钮
 */
export function messageBody(text) {
	const wrapper = document.createElement('div')
	wrapper.className = 'message-view'
	const button = document.createElement('button')
	button.type = 'button'
	button.className = 'btn btn-ghost btn-xs message-view-toggle'
	button.setAttribute('user-content', '')
	button.textContent = geti18n('agent_studio.conversation.plainView')
	button.setAttribute('aria-label', geti18n('agent_studio.conversation.switchView'))
	const body = document.createElement('div')
	body.className = 'markdown-body message-view-body'
	body.setAttribute('prompt-content', '')
	const raw = String(text ?? '')
	let plain = true
	/** @returns {void} 绘制当前正文视图。 */
	const paint = () => {
		button.textContent = geti18n(plain ? 'agent_studio.conversation.markdownView' : 'agent_studio.conversation.plainView')
		const element = document.createElement(plain ? 'pre' : 'div')
		element.className = plain ? 'message-view-plain' : 'markdown-body'
		if (plain) element.textContent = raw
		body.replaceChildren(element)
		if (!plain) void renderMarkdownAsString(raw).then(html => {
			if (element.isConnected) element.innerHTML = html
		})
	}
	button.addEventListener('click', () => { plain = !plain; paint() })
	wrapper.append(button, body)
	paint()
	return wrapper
}
