/**
 * Hub 单条流式消息：对展示文本做 rAF 平滑逼近并渲染 Markdown。
 * 默认未信任档；绑定后可由外层按 `isTrustedMarkdownAuthor` 升档。
 * 联邦 `stream_chunk` 验签不绑定消息作者，故不得按「本机消息」一刀切放开。
 *
 * `allowDangerousHtml` 决定 Markdown 是否保留内联 HTML 结构（如 reasoning 的
 * `<details>`）。写入前始终用 `scrubHtmlActivePayload` 剥离活动内容，
 * 再将安全节点合入现有 DOM，与信任档无关。
 */
import { ensureClosedTrailingCodeFence } from '../../../../scripts/features/markdown/codeFence.mjs'
import { renderMarkdownAsString } from '../../../../scripts/features/markdown/index.mjs'
import { scrubHtmlActivePayload } from '../../../../scripts/lib/sanitizeHtml.mjs'

/**
 * 同步同名元素：先对齐属性，再按需递归；代码块额外保留 id/open 与工具按钮。
 * @param {Element} current - 现有元素。
 * @param {Element} next - 新渲染的同名元素。
 */
function reconcileElement(current, next) {
	const codeBlock = current.classList.contains('markdown-code-block') && next.classList.contains('markdown-code-block')
	// 代码块保留旧 id（工具按钮脚本引用）与 open（用户折叠状态），只同步其余属性。
	for (const { name } of [...current.attributes]) {
		if (codeBlock && (name === 'id' || name === 'open')) continue
		if (!next.hasAttribute(name)) current.removeAttribute(name)
	}
	for (const { name, value } of [...next.attributes]) {
		if (codeBlock && (name === 'id' || name === 'open')) continue
		if (current.getAttribute(name) !== value) current.setAttribute(name, value)
	}
	if (codeBlock) {
		// 工具按钮中的脚本引用旧 id；保留按钮与图标，只更新代码和行数。
		const oldPre = current.querySelector('pre')
		const newPre = next.querySelector('pre')
		if (oldPre && newPre) reconcileChildren(oldPre, newPre)
		const oldSummary = current.querySelector(':scope > summary')
		const newSummary = next.querySelector(':scope > summary')
		if (oldSummary && newSummary && oldSummary.textContent !== newSummary.textContent)
			oldSummary.textContent = newSummary.textContent
		return
	}
	reconcileChildren(current, next)
}

/**
 * 将新渲染的节点合入旧树，保留流式追加时已经出现的元素。
 * @param {Node} current - 现有父节点。
 * @param {Node} next - 新渲染的父节点。
 */
function reconcileChildren(current, next) {
	const oldNodes = [...current.childNodes]
	const newNodes = [...next.childNodes]
	for (let i = 0; i < newNodes.length; i++) {
		const oldNode = oldNodes[i]
		const newNode = newNodes[i]
		if (!oldNode) current.appendChild(newNode)
		else if (oldNode.isEqualNode(newNode)) continue
		else if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) oldNode.replaceWith(newNode)
		else if (oldNode.nodeType === Node.TEXT_NODE) oldNode.textContent = newNode.textContent
		else if (oldNode.nodeType !== Node.ELEMENT_NODE) oldNode.replaceWith(newNode)
		else reconcileElement(oldNode, newNode)
	}
	for (let i = newNodes.length; i < oldNodes.length; i++) oldNodes[i].remove()
}

/** Hub 流式消息 Markdown 渲染器。 */
export class StreamRenderer {
	/** @type {HTMLElement} */
	#bodyElement
	#targetText = ''
	#displayedText = ''
	#markdownCache = {}
	#lastRendered = null
	#animationFrameId = null
	#allowDangerousHtml = false
	#transform = null

	/**
	 * @param {HTMLElement} bodyElement 流式正文容器
	 * @param {{ allowDangerousHtml?: boolean, transform?: ((text: string) => string)|null }} [options] 是否保留 Markdown 内联 HTML 结构；transform 为渲染前的原文变换
	 */
	constructor(bodyElement, { allowDangerousHtml = false, transform = null } = {}) {
		if (!(bodyElement instanceof HTMLElement))
			throw new TypeError('StreamRenderer requires an HTMLElement')
		this.#bodyElement = bodyElement
		this.attachedTo = bodyElement
		this.#allowDangerousHtml = !!allowDangerousHtml
		this.#transform = typeof transform === 'function' ? transform : null
	}

	/**
	 * @param {string} text 新的完整展示文本
	 * @returns {void}
	 */
	setTarget(text) {
		this.#targetText = text
		this.#startLoop()
	}

	/**
	 * 升/降信任档；变更时强制重渲当前已显示文本。
	 * @param {boolean} trusted 是否允许危险 HTML
	 * @returns {void}
	 */
	setTrusted(trusted) {
		const next = !!trusted
		if (this.#allowDangerousHtml === next) return
		this.#allowDangerousHtml = next
		this.#markdownCache = {}
		this.#lastRendered = null
		this.#startLoop()
	}

	/**
	 * @returns {Promise<void>}
	 */
	async finish() {
		if (this.#animationFrameId) {
			cancelAnimationFrame(this.#animationFrameId)
			this.#animationFrameId = null
		}
		this.#displayedText = this.#targetText
		await this.#renderFrame()
	}

	/**
	 * @returns {void}
	 */
	#startLoop() {
		if (this.#animationFrameId) return
		/**
		 * @returns {Promise<void>}
		 */
		const loop = async () => {
			if (!this.#bodyElement.isConnected) {
				this.#animationFrameId = null
				return
			}
			if (this.#targetText.startsWith(this.#displayedText)) {
				const lag = this.#targetText.length - this.#displayedText.length
				const step = Math.max(1, Math.ceil(lag / 5))
				this.#displayedText = this.#targetText.substring(0, this.#displayedText.length + step)
			}
			else
				this.#displayedText = this.#targetText

			await this.#renderFrame()

			if (this.#displayedText !== this.#targetText) {
				this.#animationFrameId = requestAnimationFrame(() => { void loop() })
				return
			}
			this.#animationFrameId = null
		}
		this.#animationFrameId = requestAnimationFrame(() => { void loop() })
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #renderFrame() {
		const text = this.#displayedText
		if (text === this.#lastRendered) return
		const appendOnly = this.#lastRendered !== null && text.startsWith(this.#lastRendered)
		this.#lastRendered = text
		const html = await renderMarkdownAsString(ensureClosedTrailingCodeFence(this.#transform?.(text) ?? text), this.#markdownCache, {
			allowDangerousHtml: this.#allowDangerousHtml,
		})
		const safeContent = scrubHtmlActivePayload(html)
		if (appendOnly) reconcileChildren(this.#bodyElement, safeContent)
		else this.#bodyElement.replaceChildren(safeContent)
		if (text.trim())
			this.#bodyElement.parentElement
				?.querySelector('.streaming-skeleton')
				?.classList.add('hidden')

	}
}
