/**
 * Hub 单条流式消息：对展示文本做 rAF 平滑逼近并渲染 Markdown。
 * 默认未信任档；绑定后可由外层按 `isTrustedMarkdownAuthor` 升档。
 * 联邦 `stream_chunk` 验签不绑定消息作者，故不得按「本机消息」一刀切放开。
 *
 * `allowDangerousHtml` 决定 Markdown 是否保留内联 HTML 结构（如 reasoning 的
 * `<details>`）。写入一律 `replaceChildren(scrubHtmlActivePayload(html))`
 *（template 内剥 `on*` / 危险 URL），与信任档无关。
 */
import { renderMarkdownAsString } from '../../../../scripts/features/markdown/index.mjs'
import { scrubHtmlActivePayload } from '../../../../scripts/lib/sanitizeHtml.mjs'

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

	/**
	 * @param {HTMLElement} bodyElement 流式正文容器
	 * @param {{ allowDangerousHtml?: boolean }} [options] 是否保留 Markdown 内联 HTML 结构
	 */
	constructor(bodyElement, { allowDangerousHtml = false } = {}) {
		if (!(bodyElement instanceof HTMLElement))
			throw new TypeError('StreamRenderer requires an HTMLElement')
		this.#bodyElement = bodyElement
		this.attachedTo = bodyElement
		this.#allowDangerousHtml = !!allowDangerousHtml
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
		if (this.#displayedText === this.#lastRendered) return
		const text = this.#displayedText
		this.#lastRendered = text
		const html = await renderMarkdownAsString(text, this.#markdownCache, {
			allowDangerousHtml: this.#allowDangerousHtml,
		})
		this.#bodyElement.replaceChildren(/** @type {DocumentFragment} */ (scrubHtmlActivePayload(html)))
		if (text.trim())
			this.#bodyElement.parentElement
				?.querySelector('.streaming-skeleton')
				?.classList.add('hidden')

	}
}
