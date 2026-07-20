/**
 * 【文件】src/streaming/bufferedUpdater.mjs
 * 【职责】把高频异步预览更新器包装为同步接口，合并连续 reply 快照并在单链 Promise 上串行 drain，避免 UI/WS 背压。
 * 【原理】update 时用 structuredClone 覆盖 lastReply 并调度 drain；drain 通过 pending 链保证同一时刻仅一个 asyncPreviewUpdater 在执行，错误经 handleError 吞掉不阻断队列。
 * 【数据结构】lastReply（content/content_for_show/files）、drainScheduled 标志、pending Promise 链。
 * 【关联】被 lineBasedStream.createBufferedLineBasedStream 使用；依赖 server.mjs handleError。
 */
import { handleError } from '../../../../../../server/server.mjs'

/**
 * 将异步预览更新器包装为同步接口：内部合并最新 reply，后台 drain 时调用异步更新器。
 *
 * @param {(reply: { content?: string, content_for_show?: string, files?: Array }) => Promise<void>} asyncPreviewUpdater 异步预览更新器
 * @returns {(reply: { content?: string, content_for_show?: string, files?: Array }) => void} 同步预览更新器
 */
export function createBufferedSyncPreviewUpdater(asyncPreviewUpdater) {
	/** @type {{ content?: string, content_for_show?: string, files?: Array } | null} */
	let lastReply = null
	let drainScheduled = false
	let pending = Promise.resolve()

	/**
	 * 串行 drain 队列：在 Promise 链上调用异步预览更新器处理合并后的 `lastReply`。
	 * @returns {void}
	 */
	function drain() {
		if (drainScheduled) return
		drainScheduled = true
		pending = pending.then(() => {
			drainScheduled = false
			const reply = lastReply
			if (!reply) return
			return Promise.resolve(asyncPreviewUpdater(reply)).catch(handleError)
		})
	}

	return function update(reply) {
		lastReply = structuredClone(reply)
		drain()
	}
}
