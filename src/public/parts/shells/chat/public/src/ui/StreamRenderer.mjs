/**
 * Hub 单条流式消息：对展示文本做 rAF 平滑逼近并渲染 Markdown。
 * 默认未信任档；绑定后可由外层按 `isTrustedMarkdownAuthor` 升档。
 * 联邦 `stream_chunk` 验签不绑定消息作者，故不得按「本机消息」一刀切放开。
 *
 * `allowDangerousHtml` 只决定 Markdown 是否保留内联 HTML 结构（如 reasoning 的
 * `<details>`），与「会不会跑脚本」无关：本类用 `innerHTML = …` 写入，HTML5 规定
 * 经 innerHTML 插入的 `<script>` **不会执行**（要执行须 createElement('script')
 * 再 append，见 template.mjs 的激活路径）。因此「流式危险档会让吓人的 script
 * 触发很多次」不成立——帧再多也只是换 DOM 文本节点，不会跑 JS。
 */
import { renderMarkdownAsString } from '../../../../scripts/features/markdown/index.mjs'

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
	 * @param {{ allowDangerousHtml?: boolean }} [options] 信任档（内联 HTML 结构，非脚本执行）
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
		// innerHTML 赋值：解析 DOM 但不执行 <script>（见文件头）
		this.#bodyElement.innerHTML = await renderMarkdownAsString(text, this.#markdownCache, {
			allowDangerousHtml: this.#allowDangerousHtml,
		})
		if (text.trim())
			this.#bodyElement.parentElement
				?.querySelector('.streaming-skeleton')
				?.classList.add('hidden')

	}
}
