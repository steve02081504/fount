/**
 * 【文件】public/hub/hashNav.mjs
 * 【职责】根据 location.hash 驱动 Hub 导航：好友列表、好友绑定私聊、或普通群+频道选择。
 * 【原理】`navigateFromHash` 解析 `parseHash()`；空 hash 或 `#friends` 切好友模式；有 groupId 时先 `loadGroups`，绑定群走 `enterFriendChat`，否则 `selectGroup`。
 * 【数据结构】hash 片段约定见 core/urlHash（`#group:groupId:channelId`、`#friends`）。
 * 【关联】init、core/urlHash、sidebar、friendBindings、friendChat、mode、serverBar。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { store } from './core/state.mjs'
import { DISCOVERY_HASH, INBOX_HASH, isFriendsHash, parseHash } from './core/urlHash.mjs'
import { bumpViewEpoch } from './core/viewEpoch.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'
import { disableComposer } from './messages/composerController.mjs'
import { loadGroups } from './serverBar.mjs'

/** @type {Promise<void>} */
let navigationQueue = Promise.resolve()

/**
 * @param {{ groupsLoaded?: boolean }} options 本次导航是否已有最新群列表
 * @returns {Promise<void>}
 */
async function navigateFromHashInner({ groupsLoaded = false }) {
	try {
		const hash = window.location.hash.slice(1)
		const { groupId, channelId, eventId } = parseHash()
		// 只有列表/发现页需要模式模块；群深链直接进入目标频道，不必下载它。
		if (!groupId) {
			const { setMode } = await import('./mode.mjs')
			if (hash === INBOX_HASH) {
				await setMode('inbox')
				return
			}
			if (hash === DISCOVERY_HASH) {
				await setMode('discovery')
				return
			}
			await setMode('friends')
			return
		}

		const sameGroup = store.context.currentGroupId === groupId
		const sameChannel = channelId === store.context.currentChannelId
		if (sameGroup && sameChannel && store.context.currentState?.channels) {
			if (eventId) await scrollToAndHighlightEventId(eventId)
			return
		}

		if (
			sameGroup
			&& channelId
			&& channelId !== store.context.currentChannelId
			&& store.context.currentState?.channels?.[channelId]
		) {
			const { selectChannel } = await import('./sidebar/index.mjs')
			await selectChannel(channelId)
			if (eventId) await scrollToAndHighlightEventId(eventId)
			return
		}

		if (!groupsLoaded) await loadGroups()
		const binding = friendBindingForGroup(groupId)
		if (binding) {
			const { enterFriendChat } = await import('./friendChat.mjs')
			await enterFriendChat({ groupId, binding, channelId: channelId || undefined })
			if (eventId) await scrollToAndHighlightEventId(eventId)
			return
		}

		const { selectGroup } = await import('./sidebar/index.mjs')
		await selectGroup(groupId, channelId)
		if (eventId) await scrollToAndHighlightEventId(eventId)
	}
	catch (error) {
		handleError('chat.hub.load.groupFailed')(error)
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
		const container = document.getElementById('messages')
		const row = container?.querySelector(`[data-message-id="${CSS.escape(eventId)}"]`)
		if (row instanceof HTMLElement) {
			row.classList.add('message--highlight')
			setTimeout(() => row.classList.remove('message--highlight'), 2000)
		}
	}
	catch { /* best-effort */ }
}

/**
 * 串行执行 hash 导航，避免 initCore 与 hashchange 并发交错。
 * @param {{ groupsLoaded?: boolean }} [options] 本次导航已加载的群列表；仅引导阶段使用
 * @returns {Promise<void>}
 */
export function navigateFromHash(options = {}) {
	const { groupId, channelId } = parseHash()
	// 导航本身要排队执行：先同步作废当前视图的在途渲染并禁用 composer，避免旧会话在换群窗口里还能输入。
	if (groupId !== store.context.currentGroupId || (channelId && channelId !== store.context.currentChannelId)) {
		bumpViewEpoch()
		disableComposer()
	}
	const run = navigationQueue.then(() => navigateFromHashInner(options))
	navigationQueue = run.catch(() => { })
	return run
}

/** @returns {boolean} 当前 hash 是否为好友列表（`#friends`） */
export function hashIsFriendsList() {
	return isFriendsHash()
}
