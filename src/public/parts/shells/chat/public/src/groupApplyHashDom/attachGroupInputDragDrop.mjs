import { addDragAndDropSupport } from '../ui/dragAndDrop.mjs'

/**
 * 在消息输入框上挂载拖放上传，文件入队由调用方处理。
 * @param {HTMLElement | null} input 消息输入框根节点
 * @param {{ enqueuePendingFile: (f: File) => void, signal: AbortSignal }} opts 入队与卸载信号
 * @returns {void}
 */
export function attachGroupInputDragDrop(input, { enqueuePendingFile, signal }) {
	if (!input) return
	addDragAndDropSupport(input, files => {
		for (const f of files) enqueuePendingFile(f)
	}, { signal })
}
