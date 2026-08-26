/**
 * 【文件】public/hub/sidebar/channels.mjs
 * 【职责】侧栏频道树渲染入口：委托给虚拟列表实现 `channelListVirtual.mjs`。
 *   （分类折叠 + 虚拟滚动细节见该模块。）
 */
import { renderChannelListVirtual } from './channelListVirtual.mjs'
import { getChannelListContainer } from './privateShell.mjs'

/**
 * 渲染频道树列表（虚拟列表；`type:category` 频道渲染为可折叠分类头）。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderChannelList(state) {
	const container = getChannelListContainer()
	if (!container || !state) return
	await renderChannelListVirtual(container, state)
}
