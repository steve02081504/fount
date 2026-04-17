// 此文件不依赖旧的 virtualQueue，直接操作传入的 DOM 元素

import { renderMarkdownAsString } from '../../../../../../pages/scripts/markdown.mjs'

const PREVIEW_THROTTLE_MS = 150

/**
 * 单条 AI 流式消息渲染器。
 * 流式阶段节流预览 Markdown；finish() 时完整渲染（无光标）。
 */
export class StreamRenderer {
	/** @type {HTMLElement|null} */
	#contentEl = null
	/** @type {HTMLSpanElement|null} */
	#cursorEl = null
	#fullText = ''
	/** @type {number} */
	#previewRafId = 0
	#lastPreviewTime = -PREVIEW_THROTTLE_MS
	#rendering = false
	#renderPending = false
	#cancelled = false
	/** @type {(() => void)[]} */
	#idleWaiters = []

	/**
	 * @param {HTMLElement} bodyEl  内容容器（预先插入 DOM）
	 */
	constructor(bodyEl) {
		this.bodyEl = bodyEl
		this.#ensureStreamDom()
		this.cache = {}
	}

	/**
	 * 在 bodyEl 内建立「内容容器 + 持久光标」结构；仅替换内容容器的 innerHTML。
	 */
	#ensureStreamDom() {
		if (!this.bodyEl || this.#contentEl) return
		const wrap = document.createElement('div')
		wrap.className = 'contents stream-markdown'
		while (this.bodyEl.firstChild)
			wrap.appendChild(this.bodyEl.firstChild)
		this.bodyEl.appendChild(wrap)
		this.#contentEl = wrap
		const cursor = document.createElement('span')
		cursor.className = 'stream-cursor'
		cursor.textContent = '▌'
		this.bodyEl.appendChild(cursor)
		this.#cursorEl = cursor
	}

	/**
	 * 等待当前预览渲染结束。
	 * @returns {Promise<void>}
	 */
	async #waitRenderIdle() {
		while (this.#rendering)
			await new Promise(r => {
				this.#idleWaiters.push(r)
			})
	}

	/** 取消预览用的 rAF */
	#cancelPreviewRaf() {
		if (this.#previewRafId) {
			cancelAnimationFrame(this.#previewRafId)
			this.#previewRafId = 0
		}
	}

	/** 唤醒在 `_rendering` 上等待的调用方（如 finish） */
	#flushIdleWaiters() {
		const w = this.#idleWaiters
		this.#idleWaiters = []
		for (const r of w) r()
	}

	/** 若尚无 rAF，则注册一次节流检查 */
	#schedulePreview() {
		if (this.#previewRafId) return
		this.#previewRafId = requestAnimationFrame(() => this.#previewRafTick())
	}

	/** rAF：距上次成功应用预览满节流间隔则渲染 */
	#previewRafTick() {
		this.#previewRafId = 0
		if (this.#cancelled || !this.bodyEl) return
		const now = performance.now()
		if (now - this.#lastPreviewTime < PREVIEW_THROTTLE_MS) {
			this.#previewRafId = requestAnimationFrame(() => this.#previewRafTick())
			return
		}
		this.#doPreviewRender()
	}

	/** 串行异步预览 Markdown，末尾加流式光标 */
	#doPreviewRender() {
		if (this.#cancelled || !this.bodyEl) return
		if (this.#rendering) {
			this.#renderPending = true
			return
		}
		const snapshot = this.#fullText
		this.#rendering = true
		this.#renderPending = false
		;(async () => {
			let applied = false
			try {
				const html = await renderMarkdownAsString(snapshot, this.cache)
				if (this.#cancelled || !this.bodyEl) return
				if (snapshot !== this.#fullText) {
					this.#renderPending = true
					return
				}
				this.#contentEl.innerHTML = html
				applied = true
			}
			finally {
				this.#rendering = false
				if (applied) this.#lastPreviewTime = performance.now()
				this.#flushIdleWaiters()
				if (!this.#cancelled && this.bodyEl && this.#renderPending)
					this.#schedulePreview()
			}
		})()
	}

	/**
	 * 追加文本块（由 WS group_stream_chunk 调用）
	 * @param {string} text 追加的纯文本片段
	 */
	appendChunk(text) {
		if (typeof text !== 'string') return
		const first = this.onFirstChunk
		if (first) {
			this.onFirstChunk = null
			first()
		}
		this.#fullText += text
		this.#schedulePreview()
	}

	/**
	 * 完成流式输出，渲染完整 Markdown
	 * @param {string} [finalText]  若提供则覆盖当前累计内容
	 */
	async finish(finalText) {
		this.#cancelPreviewRaf()
		await this.#waitRenderIdle()
		this.#cancelPreviewRaf()
		const full = finalText !== undefined && finalText !== null
			? String(finalText)
			: this.#fullText
		if (!this.bodyEl) return
		const html = await renderMarkdownAsString(full, this.cache)
		if (!this.bodyEl) return
		this.#cursorEl?.remove()
		this.#cursorEl = null
		if (this.#contentEl)
			this.#contentEl.innerHTML = html
		else
			this.bodyEl.innerHTML = html
	}

	/** 取消（stream 提前中止时调用） */
	cancel() {
		this.#cancelled = true
		this.#cancelPreviewRaf()
		this.#renderPending = false
		this.#flushIdleWaiters()
	}
}
