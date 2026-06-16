/**
 * Hub 单条流式消息：对展示文本做 rAF 平滑逼近并渲染 Markdown。
 */
import { renderMarkdownAsString } from '../../../../scripts/markdown.mjs'

/** Hub 流式消息 Markdown 渲染器。 */
export class StreamRenderer {
	/** @type {HTMLElement} */
	#bodyElement
	#targetText = ''
	#displayedText = ''
	#markdownCache = {}
	#lastRendered = null
	#animationFrameId = null

	/**
	 * @param {HTMLElement} bodyElement 流式正文容器
	 */
	constructor(bodyElement) {
		if (!(bodyElement instanceof HTMLElement))
			throw new TypeError('StreamRenderer requires an HTMLElement')
		this.#bodyElement = bodyElement
		this.attachedTo = bodyElement
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
		this.#bodyElement.innerHTML = await renderMarkdownAsString(text, this.#markdownCache)
		if (text.trim())
			this.#bodyElement.parentElement
				?.querySelector('.hub-streaming-skeleton')
				?.classList.add('hidden')

	}
}
