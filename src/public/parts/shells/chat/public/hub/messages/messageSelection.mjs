/**
 * 【文件】public/hub/messages/messageSelection.mjs
 * 【职责】频道消息多选：原生文字选择跨消息自动升变 / 拖选、选中高亮、Ctrl+C 复制与浮动工具条。
 * 【原理】基于通用 selectionController 的区间选择；有序 id 取自 `store.messages.channelMessages`
 *   （非 DOM），因此虚拟滚动只渲染窗口也能选择全部已加载消息。范围仅存首尾，可覆盖数万条。
 * 【关联】../../../scripts/components/selectionController.mjs、../core/state、../core/domUtils、./render/text。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { bindSelectionShortcuts, bindSelectionUpgrade, createSelectionController } from '/scripts/components/selectionController.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { authorPresentationKeys, formatMessageTimeText } from '../core/domUtils.mjs'
import { store } from '../core/state.mjs'

import { getMessageText } from './render/text.mjs'

/** 选择模式下点击不触发选择切换的元素。 */
const IGNORE_CLICK_SELECTOR = 'a, button, input, textarea, select, [contenteditable="true"], .message-hover-bar, .message-actions, .message-reaction'

/** @type {ReturnType<typeof createSelectionController> | null} */
let controller = null
/** @type {HTMLElement | null} */
let boundContainer = null
/** @type {(() => void) | null} */
let unbindUpgrade = null
/** @type {(() => void) | null} */
let unbindShortcuts = null
/** @type {HTMLElement | null} */
let toolbar = null
/** @type {HTMLElement | null} */
let countElement = null
/** @type {HTMLElement | null} */
let copyButton = null
/** @type {HTMLElement | null} */
let cancelButton = null
/** 有序 id 缓存（按 `channelMessages` 数组引用失效）。 */
let orderSource = null
/** @type {string[]} */
let orderIds = []

/**
 * 当前频道完整有序消息 id（排除未读分割线等非消息行）。
 * @returns {string[]} eventId 列表
 */
function orderedMessageIds() {
	const rows = store.messages.channelMessages
	if (rows !== orderSource) {
		orderSource = rows
		orderIds = rows
			.filter(row => row && row.type !== 'unread_divider' && row.eventId != null)
			.map(row => String(row.eventId))
	}
	return orderIds
}

/** @returns {boolean} 是否处于消息多选模式 */
export function isMessageSelectionActive() {
	return !!controller?.getMode()
}

/** @returns {string[]} 当前选中的消息 eventId */
export function getSelectedMessageIds() {
	return controller ? controller.getSelected() : []
}

/** @returns {void} 清空消息选择并退出选择模式 */
export function clearMessageSelection() {
	controller?.clear()
}

/**
 * 将当前选择同步到已渲染消息行的高亮 class。
 * @param {HTMLElement | null} [container] 消息容器（缺省用已绑定容器）
 * @returns {void}
 */
export function syncMessageSelectionStyles(container = boundContainer) {
	if (!controller || !container) return
	for (const row of container.querySelectorAll('.message-row[data-message-id]')) {
		const id = row.getAttribute('data-message-id') || ''
		row.classList.toggle('is-selected', controller.isSelected(id))
	}
}

/**
 * 从消息行读取展示名（优先消息内快照）。
 * @param {object} message 消息
 * @returns {string} 展示名
 */
function messageDisplayName(message) {
	const snap = message.content?.name
		|| message.extension?.display?.name
		|| message.extension?.chat?.display?.name
	if (snap) return String(snap)
	const authorKey = message.charId ?? message.sender ?? '?'
	return authorPresentationKeys(authorKey).displayName
}

/**
 * 收集当前选中的消息行（按有序顺序，跳过无正文结构）。
 * @returns {object[]} 消息行
 */
function collectSelectedMessages() {
	const byId = new Map(
		store.messages.channelMessages.map(row => [String(row.eventId), row]),
	)
	const rows = []
	for (const id of controller.getSelected()) {
		const message = byId.get(id)
		if (!message || message.type === 'unread_divider') continue
		rows.push(message)
	}
	return rows
}

/**
 * 写剪贴板：优先 HTML+纯文本多类型，失败回退纯文本。
 * @param {string} html HTML 载荷
 * @param {string} text 纯文本载荷
 * @returns {Promise<boolean>} 是否成功
 */
async function writeClipboard(html, text) {
	try {
		if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
			await navigator.clipboard.write([new ClipboardItem({
				'text/html': new Blob([html], { type: 'text/html' }),
				'text/plain': new Blob([text], { type: 'text/plain' }),
			})])
			return true
		}
	}
	catch { /* 回退 writeText */ }
	try {
		await navigator.clipboard.writeText(text)
		return true
	}
	catch {
		return false
	}
}

/**
 * 复制选中消息为 HTML / 文本：`HH:MM · 发言人` + 换行 + 正文（安全转义纯文本）。
 * @param {ReturnType<typeof createSelectionController>} activeController 控制器
 * @returns {boolean} 是否已处理（始终 true，交由快捷键阻止默认行为）
 */
function copySelection(activeController) {
	const rows = collectSelectedMessages()
	if (!rows.length) return false
	const htmlParts = []
	const textParts = []
	for (const message of rows) {
		const time = Number(message.timestamp) || Number(message.hlc?.wall) || 0
		const meta = `${formatMessageTimeText(time)} · ${messageDisplayName(message)}`
		const content = getMessageText(message) || ''
		htmlParts.push(
			`<div class="fount-message"><div class="fount-message-meta">${escapeHtml(meta)}</div>`
			+ `<div class="fount-message-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div></div>`,
		)
		textParts.push(`${meta}\n${content}`)
	}
	const html = `<div class="fount-messages">${htmlParts.join('')}</div>`
	const text = textParts.join('\n\n')
	writeClipboard(html, text).then(ok => {
		if (ok) showToastI18n('success', 'chat.hub.selection.copied', { count: rows.length })
	})
	return true
}

/**
 * 将工具条定位到消息区顶部中央。
 * @returns {void}
 */
function positionToolbar() {
	if (!toolbar || !boundContainer) return
	const rect = boundContainer.getBoundingClientRect()
	toolbar.style.left = `${rect.left + rect.width / 2}px`
	toolbar.style.top = `${rect.top + 12}px`
}

/**
 * 按当前选中数刷新工具条显隐与计数。
 * @param {number} count 选中数
 * @returns {void}
 */
function updateToolbar(count) {
	if (!toolbar) return
	const visible = !!controller?.getMode()
	toolbar.hidden = !visible
	if (!visible) return
	if (countElement) setElementI18n(countElement, 'chat.hub.selection.count', { count })
	if (copyButton) setElementI18n(copyButton, 'chat.hub.selection.copy')
	if (cancelButton) setElementI18n(cancelButton, 'chat.hub.selection.cancel')
	positionToolbar()
}

/**
 * 创建浮动工具条（含数量 / 复制 / 取消），仅创建一次。
 * @returns {void}
 */
function ensureToolbar() {
	if (toolbar) return
	toolbar = document.createElement('nav')
	toolbar.className = 'message-selection-toolbar'
	toolbar.hidden = true
	toolbar.innerHTML = `
		<div class="message-selection-toolbar-inner" role="toolbar" data-i18n="chat.hub.selection.toolbar">
			<span class="message-selection-count" role="status"></span>
			<button type="button" class="btn btn-xs btn-ghost message-selection-copy" data-i18n="chat.hub.selection.copy"></button>
			<button type="button" class="btn btn-xs btn-ghost message-selection-cancel" data-i18n="chat.hub.selection.cancel"></button>
		</div>
	`
	countElement = toolbar.querySelector('.message-selection-count')
	copyButton = toolbar.querySelector('.message-selection-copy')
	cancelButton = toolbar.querySelector('.message-selection-cancel')
	copyButton?.addEventListener('click', () => {
		if (controller) copySelection(controller)
	})
	cancelButton?.addEventListener('click', () => clearMessageSelection())
	document.body.appendChild(toolbar)
}

/**
 * 容器内点击：选择模式下切换命中行；点击空白处取消全部。
 * @param {MouseEvent} event 点击事件
 * @returns {void}
 */
function onContainerClick(event) {
	if (!controller || !boundContainer) return
	const target = /** @type {HTMLElement} */ event.target
	const row = target.closest?.('.message-row[data-message-id]')
	if (row && boundContainer.contains(row)) {
		if (target.closest?.(IGNORE_CLICK_SELECTOR)) return
		const modifier = event.ctrlKey || event.metaKey || event.shiftKey
		if (!controller.getMode() && !modifier) return
		event.preventDefault()
		event.stopPropagation()
		controller.handleClick(row.getAttribute('data-message-id') || '', {
			shift: event.shiftKey,
			ctrl: event.ctrlKey || event.metaKey,
		})
		return
	}
	if (controller.getMode() && !target.closest?.('.message-selection-toolbar'))
		clearMessageSelection()
}

/**
 * 为消息容器绑定多选（幂等；容器为虚拟列表固定的 `#messages`）。
 * @param {HTMLElement} container 消息容器
 * @returns {void}
 */
export function bindMessageSelection(container) {
	if (!(container instanceof HTMLElement)) return
	if (boundContainer === container && controller) return

	unbindUpgrade?.()
	unbindShortcuts?.()
	boundContainer = container
	controller = createSelectionController({
		getOrderedIds: orderedMessageIds,
		/** @param {{ count: number }} state 选中态 */
		onChange: ({ count }) => {
			syncMessageSelectionStyles(container)
			updateToolbar(count)
		},
		plainClick: 'toggle',
		shiftRange: 'add',
	})
	unbindUpgrade = bindSelectionUpgrade(container, {
		itemSelector: '.message-row[data-message-id]',
		/**
		 * @param {HTMLElement} row 消息行
		 * @returns {string | null} 消息 eventId
		 */
		getId: row => row.getAttribute('data-message-id'),
		controller,
		/**
		 * @param {EventTarget | null} target 事件目标
		 * @returns {boolean} 是否忽略该起点
		 */
		shouldIgnore: target => !!target?.closest?.(IGNORE_CLICK_SELECTOR),
	})
	unbindShortcuts = bindSelectionShortcuts(controller, {
		onCopy: copySelection,
		/**
		 * @returns {boolean} 是否存在可选择消息
		 */
		canSelectAll: () => orderedMessageIds().length > 0,
	})
	container.addEventListener('click', onContainerClick, true)
	ensureToolbar()
	syncMessageSelectionStyles(container)
}

window.addEventListener('resize', positionToolbar)
