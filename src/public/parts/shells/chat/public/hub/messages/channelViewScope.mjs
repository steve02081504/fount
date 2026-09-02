/**
 * 【文件】public/hub/messages/channelViewScope.mjs
 * 【职责】频道消息写操作（增量刷新 / 编辑 / 删除）的「当前视图」作用域守卫。
 * 操作发起时捕获 `{ epoch, groupId, channelId }`，跨 await 落地前用
 * `isChannelViewScopeCurrent` 复核：视图代际已变或当前群/频道已切换则放弃，
 * 防止旧视图在途 fetch 的结果被画进新视图共享的 `#messages` 容器。
 */
import { store } from '../core/state.mjs'
import { currentViewEpoch } from '../core/viewEpoch.mjs'

/**
 * @param {string | null | undefined} groupId 发起时的群 ID
 * @param {string | null | undefined} channelId 发起时的频道 ID
 * @returns {{ epoch: number, groupId: string | null | undefined, channelId: string | null | undefined }} 作用域快照
 */
export function captureChannelViewScope(groupId, channelId) {
	return { epoch: currentViewEpoch(), groupId, channelId }
}

/**
 * @param {{ epoch: number, groupId: string | null | undefined, channelId: string | null | undefined } | null | undefined} scope 作用域快照
 * @returns {boolean} 该作用域是否仍是当前视图
 */
export function isChannelViewScopeCurrent(scope) {
	return !!scope
		&& scope.epoch === currentViewEpoch()
		&& store.context.currentGroupId === scope.groupId
		&& store.context.currentChannelId === scope.channelId
}
