/**
 * 【文件】public/hub/messages/messageDragExport.mjs
 * 【职责】从消息行拖出独立 HTML 文件（桌面 DownloadURL），并附带 markdown/plain 载荷。
 * 【原理】对齐旧 chat：非正文区 mousedown 才 draggable；mousedown 预生成 HTML Blob；
 *   mouseup / mouseleave / dragend 取消 draggable；Blob 在拖拽结束或未拖拽松开时回收。
 */
import { renderMarkdownAsStandAloneHtmlString } from '../../../../../scripts/features/markdown/index.mjs'

import { findContextMessage, getChannelMessageActionsContext } from './messageActionsState.mjs'
import { getMessageText } from './render/text.mjs'

const ROW_SELECTOR = '.message[data-message-id], .message-row[data-message-id]'
const NO_DRAG_SELECTOR = [
	'.message-content',
	'textarea',
	'button',
	'a',
	'input',
	'select',
	'.message-hover-bar',
	'.message-actions',
	'.chat-footer',
	'.message-reaction',
].join(', ')

/**
 * @typedef {{ url: string, markdown: string, htmlSnippet: string }} DragPayload
 */

/** @type {WeakMap<HTMLElement, DragPayload>} */
const dragPayloads = new WeakMap()

/** @type {WeakSet<HTMLElement>} */
const dragInFlightRows = new WeakSet()

/**
 * @param {HTMLElement} row 消息行
 * @returns {void}
 */
function clearDragPayload(row) {
	const payload = dragPayloads.get(row)
	if (!payload) return
	URL.revokeObjectURL(payload.url)
	dragPayloads.delete(row)
}

/**
 * @param {HTMLElement} row 消息行
 * @returns {Promise<void>}
 */
async function prepareDragPayload(row) {
	const actions = getChannelMessageActionsContext(row)
	const message = actions ? findContextMessage(row, actions) : null
	const contentEl = row.querySelector('.message-content')
	const markdown = getMessageText(message) || contentEl?.textContent?.trim() || ''
	if (!markdown) return

	const html = await renderMarkdownAsStandAloneHtmlString(markdown, {})
	if (!row.isConnected || !row.draggable) return

	clearDragPayload(row)
	dragPayloads.set(row, {
		url: URL.createObjectURL(new Blob([html], { type: 'text/html' })),
		markdown,
		htmlSnippet: contentEl?.innerHTML || '',
	})
}

/**
 * @param {HTMLElement} row 消息行
 * @returns {void}
 */
function armRowDragCleanup(row) {
	/**
	 *
	 */
	const cleanupDraggable = () => { row.draggable = false }
	/**
	 *
	 */
	const onDragEnd = () => {
		cleanupDraggable()
		dragInFlightRows.delete(row)
		clearDragPayload(row)
		teardown()
	}
	/**
	 *
	 */
	const onMouseUp = () => {
		cleanupDraggable()
		if (!dragInFlightRows.has(row)) clearDragPayload(row)
		teardown()
	}
	/**
	 *
	 */
	const teardown = () => {
		row.removeEventListener('mouseup', onMouseUp)
		row.removeEventListener('mouseleave', cleanupDraggable)
		row.removeEventListener('dragend', onDragEnd)
	}
	row.addEventListener('mouseup', onMouseUp)
	row.addEventListener('mouseleave', cleanupDraggable)
	row.addEventListener('dragend', onDragEnd)
}

/**
 * 为消息列表绑定拖出导出（仅绑定一次）。
 * @param {HTMLElement} container `#messages` 或线程消息容器
 * @returns {void}
 */
export function bindMessageDragExport(container) {
	if (!(container instanceof HTMLElement)) return
	if (container.dataset.messageDragBound === '1') return
	container.dataset.messageDragBound = '1'

	container.addEventListener('mousedown', event => {
		if (event.button !== 0) return
		const row = /** @type {HTMLElement | null} */ event.target.closest(ROW_SELECTOR)
		if (!row || !container.contains(row)) return
		if (/** @type {HTMLElement} */ event.target.closest(NO_DRAG_SELECTOR)) {
			row.draggable = false
			return
		}
		row.draggable = true
		armRowDragCleanup(row)
		void prepareDragPayload(row)
	})

	container.addEventListener('dragstart', event => {
		const row = /** @type {HTMLElement | null} */ event.target.closest(ROW_SELECTOR)
		if (!row?.draggable || !event.dataTransfer) return

		const payload = dragPayloads.get(row)
		const actions = getChannelMessageActionsContext(row)
		const message = actions ? findContextMessage(row, actions) : null
		const eventId = String(message?.eventId || row.getAttribute('data-message-id') || 'export')
		const contentEl = row.querySelector('.message-content')
		const markdown = payload?.markdown || getMessageText(message) || contentEl?.textContent?.trim() || ''
		if (!markdown && !payload?.url) {
			event.preventDefault()
			row.draggable = false
			clearDragPayload(row)
			return
		}

		dragInFlightRows.add(row)

		// HTML Blob 未就绪时退化为同步 markdown 文件，保证拖到桌面总能落盘
		const useHtml = !!payload?.url
		const fileName = useHtml ? `message-${eventId}.html` : `message-${eventId}.md`
		const mime = useHtml ? 'text/html' : 'text/markdown'
		let blobUrl = payload?.url
		if (!blobUrl) {
			blobUrl = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
			dragPayloads.set(row, {
				url: blobUrl,
				markdown,
				htmlSnippet: contentEl?.innerHTML || '',
			})
		}

		event.dataTransfer.effectAllowed = 'copy'
		event.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${blobUrl}`)
		event.dataTransfer.setData('text/plain', contentEl?.textContent?.trim() || markdown)
		event.dataTransfer.setData('text/markdown', markdown)
		const htmlSnippet = payload?.htmlSnippet || contentEl?.innerHTML
		if (htmlSnippet)
			event.dataTransfer.setData('text/html', htmlSnippet)
	})
}
