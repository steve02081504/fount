/**
 * 【文件】public/hub/hashNav.mjs
 * 【职责】根据 location.hash 驱动 Hub 导航：好友列表、好友绑定私聊、或普通群+频道选择。
 * 【原理】`navigateFromHash` 解析 `parseHash()`；空 hash 或 `#friends` 切好友模式；有 groupId 时先 `loadGroups`，绑定群走 `enterFriendChat`，否则 `selectGroup`。
 * 【数据结构】hash 片段约定见 core/urlHash（`#group:groupId:channelId`、`#friends`）。
 * 【关联】init、core/urlHash、groupNav、friendBindings、friendChat、mode、serverBar。
 */
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { FRIENDS_HASH, isFriendsHash, MENTIONS_HASH, parseHash } from './core/urlHash.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'
import { enterFriendChat } from './friendChat.mjs'
import { selectChannel, selectGroup } from './groupNav.mjs'
import { setMode } from './mode.mjs'
import { loadGroups } from './serverBar.mjs'

/** @type {Promise<void>} */
let navigationQueue = Promise.resolve()

/**
 * @returns {Promise<void>}
 */
async function navigateFromHashInner() {
	try {
		const hash = window.location.hash.slice(1)
		if (hash === MENTIONS_HASH) {
			await setMode('mentions')
			return
		}
		if (!hash || hash === FRIENDS_HASH) {
			await setMode('friends')
			return
		}
		const { groupId, channelId } = parseHash()
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
			return
		}

		await loadGroups()
		const binding = friendBindingForGroup(groupId)
		if (binding) {
			await enterFriendChat({ groupId, binding, channelId: channelId || undefined })
			return
		}

		await selectGroup(groupId, channelId)
	}
	catch (error) {
		handleUIError(error, 'chat.hub.loadGroupFailed')
	}
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
