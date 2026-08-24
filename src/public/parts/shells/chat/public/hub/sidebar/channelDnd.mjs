/**
 * 【文件】public/hub/sidebar/channelDnd.mjs
 * 【职责】频道树分类拖拽重排：纯函数计算落点、Pointer 事件驱动的跨端拖拽（桌面按下拖动 / 触屏长按震动）、
 *   确认弹窗与 3 分钟豁免期、执行 links 重排。
 * 【原理】所有移动统一为「从源父节点 `links` 移除，插入目标父节点 `links` 指定位置」；根级父节点即隐藏根容器频道。
 * 【数据结构】`computeMoveOperation` 返回 `{ sourceParentId, targetParentId, targetIndex, placement }`。
 * 【关联】channelListVirtual、groupChannel endpoints、confirmAction。
 */

import { showToastI18n } from '/scripts/features/toast.mjs'
import { confirmAction } from '/scripts/features/promptDialog.mjs'
import { buildMoveLinks, computeMoveOperation, DROP_PLACEMENT } from '../shared/channelReorder.mjs'
import { updateChannel } from '../src/endpoints/groupChannel.mjs'
import { getGroupState } from '../src/endpoints/groupCore.mjs'
import { store } from './core/state.mjs'

/** 拖拽确认豁免窗口（毫秒）：成功执行一次移动后，此窗口内再次拖拽不再弹确认。 */
const REORDER_EXEMPT_MS = 3 * 60 * 1000
/** @type {number} 上次成功执行移动的时间戳（页面级模块变量）。 */
let lastReorderAt = 0

/**
 * 距上次确认移动是否仍在豁免窗口内。
 * @returns {boolean} 豁免期内为 true
 */
export function isReorderConfirmExempt() {
	return Date.now() - lastReorderAt < REORDER_EXEMPT_MS
}

/** 标记一次移动已确认执行（刷新豁免计时起点）。 */
export function markReorderExecuted() {
	lastReorderAt = Date.now()
}

/**
 * 根据落点返回确认文案的 i18n 键与参数。
 * @param {object} op 移动操作
 * @param {string} sourceName 被拖拽频道名
 * @param {Record<string, object>} channels 频道表
 * @returns {{ i18nKey: string, params: Record<string, string> }} 确认文案键与参数
 */
function reorderConfirmPayload(op, sourceName, channels) {
	if (op.placement === DROP_PLACEMENT.ROOT)
		return { i18nKey: 'chat.hub.category.reorder.toRoot', params: { source: sourceName } }
	const targetName = channels?.[op.targetParentId]?.name || op.targetParentId
	const i18nKey = op.placement === DROP_PLACEMENT.INTO
		? 'chat.hub.category.reorder.into'
		: op.placement === DROP_PLACEMENT.BEFORE
			? 'chat.hub.category.reorder.before'
			: 'chat.hub.category.reorder.after'
	return { i18nKey, params: { source: sourceName, target: targetName } }
}

/**
 * 执行一次已确认的移动：重排源/目标父 links 并刷新列表。
 * @param {string} groupId 群 ID
 * @param {string} sourceId 被拖拽频道 id
 * @param {object} op 移动操作
 * @param {() => Promise<void>} onExecuted 执行完成后的刷新回调
 * @returns {Promise<boolean>} 是否成功
 */
async function executeMove(groupId, sourceId, op, onExecuted) {
	try {
		const state = await getGroupState(groupId)
		const { sourceLinks, targetLinks } = buildMoveLinks(state.channels || {}, op, sourceId)
		if (op.sourceParentId === op.targetParentId)
			await updateChannel(groupId, op.targetParentId, { links: targetLinks })
		else {
			await updateChannel(groupId, op.sourceParentId, { links: sourceLinks })
			await updateChannel(groupId, op.targetParentId, { links: targetLinks })
		}
		markReorderExecuted()
		await onExecuted()
		return true
	}
	catch (error) {
		showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		return false
	}
}

/**
 * 发起一次落点移动：豁免期内直接执行，否则弹确认。
 * @param {string} groupId 群 ID
 * @param {string} sourceId 被拖拽频道 id
 * @param {object} op 移动操作
 * @param {() => Promise<void>} onExecuted 刷新回调
 * @returns {Promise<void>}
 */
async function applyMove(groupId, sourceId, op, onExecuted) {
	if (isReorderConfirmExempt()) {
		await executeMove(groupId, sourceId, op, onExecuted)
		return
	}
	const { state } = store.context.currentState || {}
	const channels = state?.channels || {}
	const sourceName = channels?.[sourceId]?.name || sourceId
	const { i18nKey, params } = reorderConfirmPayload(op, sourceName, channels)
	if (!await confirmAction(i18nKey, params)) return
	await executeMove(groupId, sourceId, op, onExecuted)
}

const DRAG_THRESHOLD_PX = 6
const LONG_PRESS_MS = 500

/**
 * 绑定分类行的拖拽发起（Pointer 事件：桌面按下拖动 / 触屏长按震动）。
 * @param {HTMLElement} element 分类行元素
 * @param {object} row 行数据
 * @param {{ groupId: string, onExecuted: () => Promise<void> }} options 上下文
 * @returns {void}
 */
export function bindCategoryDrag(element, row, { groupId, onExecuted }) {
	element.dataset.channelId = row.id
	/** @type {{ x: number, y: number, t: number } | null} 按下起点 */
	let downPoint = null
	/** @type {number | null} 触屏长按定时器 */
	let longPressTimer = null
	/** @type {boolean} 是否正在拖拽 */
	let dragging = false
	/** @type {HTMLDivElement | null} 拖拽幽灵元素 */
	let ghost = null
	/** @type {(e: PointerEvent) => void} pointermove 处理器 */
	let onPointerMove = null
	/** @type {(e: PointerEvent) => void} pointerup 处理器 */
	let onPointerUp = null
	/** @type {(e: Event) => void} click 抑制器 */
	let onClickBlocker = null

	/** 计算指针当前悬停的落点。 */
	function resolveDrop(clientX, clientY) {
		const container = document.querySelector('.channel-list-virtual')
		const candidates = [...(container?.querySelectorAll('.channel-item, .category') || [])]
		const top = container?.getBoundingClientRect().top || 0
		// 根级空白：指针越过当前最后一个行下方，或落在列表上半部空白区。
		if (clientY > top + (container?.clientHeight || 0)) return { targetId: null, placement: DROP_PLACEMENT.ROOT }
		let best = null
		for (const el of candidates) {
			const rect = el.getBoundingClientRect()
			if (clientY < rect.top || clientY > rect.bottom || clientX < rect.left || clientX > rect.right) continue
			const isCategory = el.classList.contains('category')
			if (isCategory) {
				const thirds = rect.height / 3
				if (clientY < rect.top + thirds) best = { targetId: el.dataset.channelId, placement: DROP_PLACEMENT.BEFORE }
				else if (clientY > rect.bottom - thirds) best = { targetId: el.dataset.channelId, placement: DROP_PLACEMENT.AFTER }
				else best = { targetId: el.dataset.channelId, placement: DROP_PLACEMENT.INTO }
			}
			else best = { targetId: el.dataset.channelId, placement: clientY < rect.top + rect.height / 2 ? DROP_PLACEMENT.BEFORE : DROP_PLACEMENT.AFTER }
			break
		}
		if (best) return best
		// 落点超出最后一个行下方视为根级。
		const last = candidates[candidates.length - 1]
		if (last && clientY > last.getBoundingClientRect().bottom) return { targetId: null, placement: DROP_PLACEMENT.ROOT }
		return { targetId: null, placement: DROP_PLACEMENT.ROOT }
	}

	/** 结束拖拽并结算。 */
	async function endDrag(event) {
		cleanup()
		if (!dragging) return
		dragging = false
		const { targetId, placement } = resolveDrop(event.clientX, event.clientY)
		const { state } = store.context.currentState || {}
		const channels = state?.channels || {}
		const rootChannelId = state?.groupSettings?.rootChannelId || null
		if (!rootChannelId) return
		const op = computeMoveOperation(channels, rootChannelId, row.id, targetId, placement)
		if (!op) return
		await applyMove(groupId, row.id, op, onExecuted)
	}

	/** 清理拖拽状态与全局监听。 */
	function cleanup() {
		if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
		if (onPointerMove) { document.removeEventListener('pointermove', onPointerMove); onPointerMove = null }
		if (onPointerUp) { document.removeEventListener('pointerup', onPointerUp); onPointerUp = null }
		if (onClickBlocker) { document.removeEventListener('click', onClickBlocker, true); onClickBlocker = null }
		if (ghost) { ghost.remove(); ghost = null }
		element.classList.remove('dragging')
	}

	/** 开始拖拽：创建幽灵、隐藏源行、注册全局监听。 */
	function startDrag(event) {
		dragging = true
		element.classList.add('dragging')
		ghost = document.createElement('div')
		ghost.className = 'channel-drag-ghost'
		ghost.textContent = element.querySelector('span')?.textContent || element.textContent
		document.body.appendChild(ghost)
		positionGhost(event.clientX, event.clientY)
		if (navigator.vibrate) navigator.vibrate(50)

		onPointerMove = (e) => {
			positionGhost(e.clientX, e.clientY)
		}
		onPointerUp = (e) => { void endDrag(e) }
		onClickBlocker = (e) => { e.stopPropagation(); e.preventDefault() }
		document.addEventListener('pointermove', onPointerMove)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('click', onClickBlocker, true)
		element.setPointerCapture?.(event.pointerId)
	}

	/** @param {number} x @param {number} y 移动幽灵元素 */
	function positionGhost(x, y) {
		if (!ghost) return
		const w = element.getBoundingClientRect().width
		ghost.style.left = `${x - w / 2}px`
		ghost.style.top = `${y - 8}px`
	}

	element.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 && event.pointerType === 'mouse') return
		downPoint = { x: event.clientX, y: event.clientY, t: Date.now() }
		if (event.pointerType === 'touch') {
			longPressTimer = setTimeout(() => {
				if (downPoint) startDrag(event)
			}, LONG_PRESS_MS)
		}
	})
	element.addEventListener('pointermove', (event) => {
		if (dragging) return
		if (!downPoint) return
		const dist = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y)
		if (event.pointerType === 'mouse' && dist > DRAG_THRESHOLD_PX)
			startDrag(event)
	})
	element.addEventListener('pointerup', () => {
		downPoint = null
		if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
	})
}
