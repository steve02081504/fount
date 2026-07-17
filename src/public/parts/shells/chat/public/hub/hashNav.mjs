/**
 * 【文件】public/hub/hashNav.mjs
 * 【职责】根据 location.hash 驱动 Hub 导航：好友列表、好友绑定私聊、或普通群+频道选择。
 * 【原理】`navigateFromHash` 解析 `parseHash()`；空 hash 或 `#friends` 切好友模式；有 groupId 时先 `loadGroups`，绑定群走 `enterFriendChat`，否则 `selectGroup`。
 * 【数据结构】hash 片段约定见 core/urlHash（`#group:groupId:channelId`、`#friends`）。
 * 【关联】init、core/urlHash、sidebar、friendBindings、friendChat、mode、serverBar。
 */
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { DISCOVERY_HASH, FRIENDS_HASH, INBOX_HASH, isFriendsHash, parseHash } from './core/urlHash.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'
import { enterFriendChat } from './friendChat.mjs'
import { setMode } from './mode.mjs'
import { loadGroups } from './serverBar.mjs'
import { selectChannel, selectGroup } from './sidebar/index.mjs'

/** @type {Promise<void>} */
let navigationQueue = Promise.resolve()

/**
 * @returns {Promise<void>}
 */
async function navigateFromHashInner() {
	try {
		const hash = window.location.hash.slice(1)
		if (hash === INBOX_HASH) {
			await setMode('inbox')
			return
		}
		if (hash === DISCOVERY_HASH) {
			await setMode('discovery')
			return
		}
		if (!hash || hash === FRIENDS_HASH) {
			await setMode('friends')
			return
		}
		const { groupId, channelId, eventId } = parseHash()
		if (!groupId) {
			await setMode('friends')
			return
		}

		if (
			hubStore.context.currentGroupId === groupId
			&& channelId
			&& channelId !== hubStore.context.currentChannelId
			&& hubStore.context.currentState?.channels?.[channelId]
		) {
			await selectChannel(channelId)
			if (eventId) await scrollToAndHighlightEventId(eventId)
			return
		}

		await loadGroups()
		const binding = friendBindingForGroup(groupId)
		if (binding) {
			await enterFriendChat({ groupId, binding, channelId: channelId || undefined })
			if (eventId) await scrollToAndHighlightEventId(eventId)
			return
		}

		await selectGroup(groupId, channelId)
		if (eventId) await scrollToAndHighlightEventId(eventId)
	}
	catch (error) {
		handleUIError(error, 'chat.hub.loadGroupFailed')
	}
}

/**
 * 滚动到指定消息并短暂高亮（eventId 定位）。
 * @param {string} eventId 目标消息 eventId
 * @returns {Promise<void>}
 */
async function scrollToAndHighlightEventId(eventId) {
	if (!eventId) return
	try {
		const { scrollToMessageEventId } = await import('./messages/messages.mjs')
		await scrollToMessageEventId(eventId)
		// 短暂高亮
		const container = document.getElementById('hub-messages')
		const row = container?.querySelector(`[data-message-id="${CSS.escape(eventId)}"]`)
		if (row instanceof HTMLElement) {
			row.classList.add('hub-message--highlight')
			setTimeout(() => row.classList.remove('hub-message--highlight'), 2000)
		}
	}
	catch { /* best-effort */ }
}

/**
 * 串行执行 hash 导航，避免 initCore 与 hashchange 并发交错。
 * @returns {Promise<void>}
 */
export function navigateFromHash() {
	const run = navigationQueue.then(() => navigateFromHashInner())
	navigationQueue = run.catch(() => { })
	return run
}

/** @returns {boolean} 当前 hash 是否为好友列表（`#friends`） */
export function hashIsFriendsList() {
	return isFriendsHash()
}
