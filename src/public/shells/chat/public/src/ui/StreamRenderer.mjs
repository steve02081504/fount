import { renderMarkdownAsString } from '../../../../../scripts/markdown.mjs'

/**
 *
 */
class StreamRenderer {
	/**
	 *
	 */
	constructor() {
		this.streamingMessages = new Map()
		this.animationFrameId = null
	}

	/**
	 * 注册一个正在进行流式传输的消息。
	 * @param {string} id - 消息的唯一 ID。
	 * @param {string} initialContent - 消息的初始内容。
	 */
	register(id, initialContent) {
		this.streamingMessages.set(id, {
			targetContent: initialContent || '',
			displayedContent: initialContent || '',
			lastRendered: null,
			domElement: document.getElementById(id), // 缓存引用
			cache: {}
		})
		this.startLoop()
	}

	/**
	 * 更新指定消息的目标内容，用于平滑渲染。
	 * @param {string} id - 消息的唯一 ID。
	 * @param {string} newContent - 消息的新内容。
	 */
	updateTarget(id, newContent) {
		const state = this.streamingMessages.get(id)
		if (state) state.targetContent = newContent
		this.startLoop()
	}

	/**
	 * 停止对指定消息的流式渲染。
	 * @param {string} id - 消息的唯一 ID。
	 */
	stop(id) {
		this.streamingMessages.delete(id)
	}

	/**
	 *
	 */
	startLoop() {
		if (this.animationFrameId || this.streamingMessages.size === 0) return

		/**
		 *
		 */
		const loop = async () => {
			if (this.streamingMessages.size === 0) {
				this.animationFrameId = null
				return
			}
			await this.renderFrame()
			this.animationFrameId = requestAnimationFrame(loop)
		}
		this.animationFrameId = requestAnimationFrame(loop)
	}

	/**
	 *
	 */
	async renderFrame() {
		for (const [id, state] of this.streamingMessages) {
			// 重新获取 DOM，防止虚拟列表滚动导致元素重建
			if (!state.domElement || !state.domElement.isConnected) {
				state.domElement = document.getElementById(id)
				if (!state.domElement) continue
			}

			// 平滑算法逻辑
			const { targetContent, displayedContent } = state
			if (targetContent.length > displayedContent.length) {
				const lag = targetContent.length - displayedContent.length
				const step = Math.max(1, Math.ceil(lag / 5))
				state.displayedContent = targetContent.substring(0, displayedContent.length + step)
			} else
				state.displayedContent = targetContent


			// 只有内容变化才操作 DOM
			if (state.displayedContent !== state.lastRendered) {
				const contentEl = state.domElement.querySelector('.message-content')
				if (contentEl)
					contentEl.innerHTML = await renderMarkdownAsString(state.displayedContent, state.cache)

				state.lastRendered = state.displayedContent
			}
		}
	}
}

/**
 *
 */
export const streamRenderer = new StreamRenderer()
