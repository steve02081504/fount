/** 可逐条切换 Markdown / 原文的消息正文，使用站点统一的 Markdown 渲染器。 */
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 在复用前缀末尾插入零宽定位锚点，供「跳到分界线」滚动到精确字符位置。
 * @returns {HTMLSpanElement} 锚点元素
 */
function boundaryMarker() {
	const mark = document.createElement('span')
	mark.className = 'prompt-boundary'
	mark.dataset.promptBoundary = ''
	return mark
}

/**
 * 创建可切换视图的消息正文。
 * @param {string} text 消息文本
 * @param {{ reusedLength?: number, boundary?: boolean, collapseLines?: number }} [options] 复用前缀字符数、是否为本轮复用分界线、超出行数时默认折叠
 * @returns {HTMLElement} 内容及视图按钮
 */
export function messageBody(text, { reusedLength = 0, boundary = false, collapseLines = 0 } = {}) {
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
	const reused = Math.max(0, Math.min(reusedLength, raw.length))
	const collapsible = collapseLines > 0 && raw.split('\n').length > collapseLines
	let collapsed = collapsible
	const toggle = document.createElement('button')
	toggle.type = 'button'
	toggle.className = 'btn btn-ghost btn-xs message-collapse-toggle'
	toggle.setAttribute('user-content', '')
	if (collapsible) toggle.addEventListener('click', () => { collapsed = !collapsed; paint() })
	let plain = true
	/** @returns {void} 绘制当前正文视图。 */
	const paint = () => {
		button.textContent = geti18n(plain ? 'agent_studio.conversation.markdownView' : 'agent_studio.conversation.plainView')
		if (collapsible) {
			const label = geti18n(collapsed ? 'agent_studio.conversation.expand' : 'agent_studio.conversation.collapse')
			toggle.textContent = label
			toggle.setAttribute('aria-label', label)
		}
		const element = document.createElement(plain ? 'pre' : 'div')
		element.className = plain ? 'message-view-plain' : 'markdown-body'
		if (collapsible && collapsed) element.classList.add('is-collapsed')
		if (plain) {
			if (reused > 0) {
				const mark = document.createElement('span')
				mark.className = 'prompt-reused'
				mark.textContent = raw.slice(0, reused)
				element.append(mark)
			}
			if (boundary) element.append(boundaryMarker())
			element.append(document.createTextNode(raw.slice(reused)))
		}
		else if (reused >= raw.length && raw.length > 0)
			element.classList.add('prompt-reused')
		body.replaceChildren(element)
		if (!plain) void renderMarkdownAsString(raw).then(html => {
			if (!element.isConnected) return
			element.innerHTML = html
			if (boundary) element.prepend(boundaryMarker())
		})
	}
	button.addEventListener('click', () => { plain = !plain; paint() })
	wrapper.append(button, ...collapsible ? [toggle] : [], body)
	paint()
	return wrapper
}
