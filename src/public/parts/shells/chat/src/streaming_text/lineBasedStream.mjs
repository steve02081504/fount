/**
 * 【文件】src/stream/lineBasedStream.mjs
 * 【职责】实现「按行稳定、末行流动」的增量流式策略，适配仅支持 append 的 ACP 等协议，并在内容回退时插入 `---` 分隔。
 * 【原理】processUpdate 只推送已换行完成的 stableText；若 stable 前缀与 covered 不一致则发 `---` 重同步；finish 对齐 displayContent 剩余尾部并经 pacedStream 推出；createBufferedLineBasedStream 外包 bufferedUpdater 使 update 同步化。
 * 【数据结构】sentText/coveredText/sentFileCount、reply（content_for_show/content/files）、lineStream `{ update, finish }`。
 * 【消费者】仅 ideIntegration ACP（agent_message_chunk）；依赖 bufferedUpdater、pacedStream。
 */
import { createBufferedSyncPreviewUpdater } from './bufferedUpdater.mjs'
import { createPacedFakeStream } from './pacedStream.mjs'

/**
 * 仅支持增量更新的按行流式策略（ACP 等协议）。
 * @param {object} options 配置
 * @param {(text: string) => void} options.onChunk 文本块回调
 * @param {(file: { buffer: ArrayBuffer|Buffer|Uint8Array, mime_type?: string }) => void} [options.onFile] 文件回调
 * @param {AbortSignal} [options.signal] 中止信号
 * @returns {{ update: Function, finish: Function }} 流式更新与结束收尾
 */
export function createLineBasedIncrementalStream(options) {
	const { onChunk, onFile, signal } = options
	const pacer = createPacedFakeStream({ onChunk, signal })
	let sentText = ''
	let coveredText = ''
	let sentFileCount = 0
	let pending = Promise.resolve()

	/**
	 * @param {string} piece 要发送的文本片段
	 * @returns {Promise<void>}
	 */
	async function send(piece) {
		if (!piece) return
		sentText += piece
		await pacer.push(piece)
	}

	/**
	 * @param {string} text 当前展示文本
	 * @param {Array} [files] 附件列表
	 * @returns {Promise<void>}
	 */
	async function processUpdate(text, files) {
		if (!text) return
		const lines = text.split('\n')
		const stableLineCount = Math.max(0, lines.length - 1)
		if (!stableLineCount) return

		const stableText = lines.slice(0, stableLineCount).join('\n') + '\n'
		if (coveredText && !stableText.startsWith(coveredText)) {
			if (sentText && !sentText.endsWith('\n')) await send('\n')
			await send('---\n')
			await send(stableText)
			coveredText = stableText
			return
		}
		if (stableText.length > coveredText.length) {
			await send(stableText.slice(coveredText.length))
			coveredText = stableText
		}
		if (onFile) {
			const list = files || []
			for (let index = sentFileCount; index < list.length; index++) onFile(list[index])
			sentFileCount = list.length
		}
	}

	/**
	 * @param {object} reply 回复对象
	 * @returns {Promise<void>}
	 */
	function update(reply) {
		const text = reply.content_for_show ?? reply.content ?? ''
		pending = pending.then(() => processUpdate(text, reply.files))
		return pending
	}

	/**
	 * @param {string} displayContent 最终展示全文
	 * @param {Array} files 最终附件列表
	 * @param {string} [noContentPlaceholder] 无内容占位
	 * @returns {Promise<void>}
	 */
	async function finish(displayContent, files, noContentPlaceholder = '(No reply content)') {
		await pending
		const display = displayContent || noContentPlaceholder
		const list = files || []
		const hasNewFiles = onFile && list.length > sentFileCount

		let remaining
		if (!sentText) remaining = display
		else if (display.startsWith(sentText)) remaining = display.slice(sentText.length)
		else if (coveredText && display.startsWith(coveredText)) remaining = display.slice(coveredText.length)
		else {
			const coveredLineCount = coveredText ? coveredText.split('\n').length - 1 : 0
			const displayLines = display.split('\n')
			const startIndex = Math.min(coveredLineCount, Math.max(0, displayLines.length - 1))
			remaining = displayLines.slice(startIndex).join('\n') || display
		}

		if (hasNewFiles) {
			const allSent = sentText + (remaining || '')
			if (allSent && !allSent.endsWith('\n')) remaining = (remaining || '') + '\n'
		}
		if (remaining) await pacer.push(remaining)
		if (hasNewFiles)
			for (let index = sentFileCount; index < list.length; index++) onFile(list[index])
	}

	return { update, finish }
}

/**
 * 带 buffer 的按行流式接口（同步 update）。
 * @param {object} options 同 createLineBasedIncrementalStream
 * @returns {{ update: Function, finish: Function }} 同步 update 的按行流
 */
export function createBufferedLineBasedStream(options) {
	const lineStream = createLineBasedIncrementalStream(options)
	return {
		update: createBufferedSyncPreviewUpdater(reply => lineStream.update(reply)),
		finish: lineStream.finish.bind(lineStream),
	}
}
