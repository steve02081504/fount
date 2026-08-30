/**
 * 将 Hub 当前群/频道上下文同步到 `document.body` dataset，供全局脚本/CSS 读取。
 * 只维护 `groupId` / `channelId` / `channels` 三个字段，不碰 `data-surface`。
 */
import { store, watchState } from './core/state.mjs'

/** @returns {void} */
function update() {
	const { currentGroupId, currentChannelId, currentState } = store.context
	if (currentGroupId) document.body.dataset.groupId = currentGroupId
	else delete document.body.dataset.groupId
	if (currentChannelId) document.body.dataset.channelId = currentChannelId
	else delete document.body.dataset.channelId
	const channels = Object.keys(currentState?.channels ?? {})
	if (channels.length) document.body.dataset.channels = JSON.stringify(channels)
	else delete document.body.dataset.channels
}

/**
 * 订阅上下文变化并立即同步一次 body dataset。
 * @returns {() => void} 取消订阅函数
 */
export function bindDomContext() {
	const unsubscribes = [
		watchState('context.currentGroupId', update),
		watchState('context.currentChannelId', update),
		watchState('context.currentState', update),
	]
	update()
	return () => { for (const unsubscribe of unsubscribes) unsubscribe() }
}
