/**
 * 【文件】public/hub/chatGestures.mjs
 * 【职责】移动端/触控聊天手势：末条角色消息左右滑动切换时间轴分支，桌面端显示箭头按钮。
 * 【原理】在 `#hub-messages` 上事件委托 touch；桌面箭头仍挂末条角色消息。群/频道 ID 直接读 hubStore。
 * 【关联】../../../../scripts/template、../src/api/groupChannel、core/state
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { modifyBranch } from '../src/api/groupChannel.mjs'

import { hubStore } from './core/state.mjs'

const CHAT_SWIPE_THRESHOLD = 50

/** @type {WeakSet<HTMLElement>} */
const swipeDelegationBound = new WeakSet()

/** @returns {string|null} 当前群 ID */
function currentGroupId() {
	return hubStore.context.currentGroupId || hubStore.privateGroup.groupId
}

/** @returns {string|null} 当前频道 ID */
function currentChannelId() {
	return hubStore.context.currentChannelId || hubStore.privateGroup.channelId
}

/** @returns {Promise<void>} 刷新频道消息 */
async function reloadMessages() {
	const { loadMessages } = await import('./messages/messages.mjs')
	await loadMessages()
}

/**
 * 角色较少时隐藏消息中的角色名。
 * @param {Array<object>} entries 频道消息或日志条目
 * @returns {void}
 */
export function updateHideCharNames(entries) {
	const uniqueChars = new Set(
		(entries || [])
			.map(entry => entry.charId || (entry.role === 'char' ? entry.name : null))
			.filter(Boolean),
	)
	document.getElementById('hub-messages')
		?.classList.toggle('hide-char-names', uniqueChars.size <= 2)
}

/**
 * @param {HTMLElement} container 消息列表根节点
 * @returns {HTMLElement|null} 末条角色消息元素
 */
function findLastCharMessage(container) {
	const charEls = container.querySelectorAll('.hub-message[data-char-id], .hub-chat-entry[data-role="char"], .hub-char-entry[data-role="char"]')
	const lastChar = charEls.length ? charEls[charEls.length - 1] : null
	return lastChar instanceof HTMLElement && !lastChar.hasAttribute('data-streaming') ? lastChar : null
}

/**
 * 在末条角色消息两侧挂载桌面时间轴箭头按钮。
 * @param {HTMLElement} lastChar 末条角色消息 DOM
 * @returns {void}
 */
async function attachDesktopTimelineArrows(lastChar) {
	lastChar.querySelectorAll('.hub-char-timeline-arrow').forEach(arrow => arrow.remove())
	const groupId = currentGroupId()
	const channelId = currentChannelId()
	if (!groupId || !channelId) return

	/**
	 * @param {number} delta 时间轴步进（-1 或 1）
	 * @returns {Promise<void>}
	 */
	const goTimeline = async delta => {
		try {
			await modifyBranch(groupId, channelId, delta)
			await reloadMessages()
		}
		catch (err) {
			console.error('timeline arrow', err)
		}
	}

	const left = await renderTemplate('hub/chat/timeline_arrow', { side: 'left', arrow: '❮' })
	left.addEventListener('click', e => {
		e.stopPropagation()
		void goTimeline(-1)
	})
	const right = await renderTemplate('hub/chat/timeline_arrow', { side: 'right', arrow: '❯' })
	right.addEventListener('click', e => {
		e.stopPropagation()
		void goTimeline(1)
	})
	lastChar.appendChild(left)
	lastChar.appendChild(right)
}

/** @type {WeakMap<HTMLElement, { startX: number, startY: number, dragging: boolean, handled: boolean }>} */
const swipeStateByElement = new WeakMap()

/**
 * @param {HTMLElement} container 消息列表根节点
 * @returns {void}
 */
function ensureSwipeDelegation(container) {
	if (swipeDelegationBound.has(container)) return
	swipeDelegationBound.add(container)

	/** @param {TouchEvent} event 触摸事件 */
	const onTouchStart = event => {
		const target = event.target instanceof Element
			? event.target.closest('.hub-message[data-char-id], .hub-chat-entry[data-role="char"], .hub-char-entry[data-role="char"]')
			: null
		if (!(target instanceof HTMLElement) || target.hasAttribute('data-streaming')) return
		const lastChar = findLastCharMessage(container)
		if (target !== lastChar) return
		if (event.touches.length !== 1) return
		swipeStateByElement.set(target, {
			startX: event.touches[0].clientX,
			startY: event.touches[0].clientY,
			dragging: true,
			handled: false,
		})
	}

	/** @param {TouchEvent} event 触摸事件 */
	const onTouchMove = event => {
		const target = event.target instanceof Element
			? event.target.closest('.hub-message[data-char-id], .hub-chat-entry[data-role="char"], .hub-char-entry[data-role="char"]')
			: null
		if (!(target instanceof HTMLElement)) return
		const state = swipeStateByElement.get(target)
		if (!state?.dragging || event.touches.length !== 1) return
		const deltaX = event.touches[0].clientX - state.startX
		const deltaY = event.touches[0].clientY - state.startY
		if (Math.abs(deltaY) > Math.abs(deltaX)) state.dragging = false
	}

	/** @param {TouchEvent} event 触摸事件 */
	const onTouchEnd = async event => {
		const target = event.target instanceof Element
			? event.target.closest('.hub-message[data-char-id], .hub-chat-entry[data-role="char"], .hub-char-entry[data-role="char"]')
			: null
		if (!(target instanceof HTMLElement)) return
		const state = swipeStateByElement.get(target)
		if (!state?.dragging || state.handled || event.changedTouches.length !== 1) {
			if (state) state.dragging = false
			return
		}
		const deltaX = event.changedTouches[0].clientX - state.startX
		const deltaY = event.changedTouches[0].clientY - state.startY
		state.dragging = false
		const groupId = currentGroupId()
		const channelId = currentChannelId()
		if (Math.abs(deltaX) > CHAT_SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) && groupId && channelId) {
			state.handled = true
			try {
				await modifyBranch(groupId, channelId, deltaX > 0 ? -1 : 1)
				await reloadMessages()
			}
			catch (err) {
				console.error('swipe timeline', err)
			}
		}
	}

	/** @param {TouchEvent} event 触摸事件 */
	const onTouchCancel = event => {
		const target = event.target instanceof Element
			? event.target.closest('.hub-message[data-char-id], .hub-chat-entry[data-role="char"], .hub-char-entry[data-role="char"]')
			: null
		if (target instanceof HTMLElement) {
			const state = swipeStateByElement.get(target)
			if (state) state.dragging = false
		}
	}

	container.addEventListener('touchstart', onTouchStart, { passive: true })
	container.addEventListener('touchmove', onTouchMove, { passive: true })
	container.addEventListener('touchend', onTouchEnd, { passive: true })
	container.addEventListener('touchcancel', onTouchCancel, { passive: true })
}

/**
 * @param {HTMLElement} container 消息列表根节点
 * @returns {void}
 */
export function attachLastCharMessageSwipe(container) {
	if (!(container instanceof HTMLElement)) return
	ensureSwipeDelegation(container)
	const lastChar = findLastCharMessage(container)
	if (!lastChar) return
	void attachDesktopTimelineArrows(lastChar)
}
