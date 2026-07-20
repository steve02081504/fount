/**
 * 非 text 频道（list / streaming）加载路由。
 */
import { getStreamingChannelAuth } from '../../src/api/groupCore.mjs'
import { refreshChannelPinsBar } from '../banners.mjs'
import { renderListChannel, renderStreamingChannel, renderCodecsAvStreamingChannel } from '../channels.mjs'
import { store } from '../core/state.mjs'
import { selectChannel, saveListChannelItems } from '../sidebar/index.mjs'
import { leaveHubAvSession } from '../streamingAv.mjs'

/**
 * 加载 list / streaming 频道 UI；text 频道返回 false。
 * @param {HTMLElement} container 消息区根
 * @param {object} channel 频道元数据
 * @returns {Promise<boolean>} 已处理则为 true
 */
export async function loadNonTextChannel(container, channel) {
	const channelType = channel?.type || 'text'
	if (channelType === 'list')
		await renderListChannel(container, store.context.currentGroupId, store.context.currentChannelId, channel, selectChannel, {
			canEdit: !!store.context.currentState?.channelCaps?.[store.context.currentChannelId]?.canEditList,
			onSave: saveListChannelItems,
		})
	else if (channelType === 'streaming') {
		await leaveHubAvSession()
		const groupSettings = store.context.currentState?.groupSettings || {}
		if (!groupSettings.streamingSfuWss?.trim())
			await renderCodecsAvStreamingChannel(container, channel, {
				groupId: store.context.currentGroupId,
				channelId: store.context.currentChannelId,
				clientId: store.context.currentState?.viewerMemberPubKeyHash || 'local',
			})
		else {
			const groupId = store.context.currentGroupId
			const channelId = store.context.currentChannelId
			const streamingViewPageUrl =
				`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/streaming-view`
			await renderStreamingChannel(container, channel, {
				streamingSfuWss: groupSettings.streamingSfuWss,
				embedUrl: streamingViewPageUrl,
				/**
				 * 刷新流媒体 iframe 的 embed 鉴权 URL。
				 * @returns {Promise<void>}
				 */
				onRefreshAuth: async () => {
					const iframe = document.getElementById('stream-iframe')
					if (!(iframe instanceof HTMLIFrameElement)) return
					try {
						const auth = await getStreamingChannelAuth(groupId, channelId)
						iframe.src = auth?.embedUrl || `${streamingViewPageUrl}?reload=${Date.now()}`
					}
					catch {
						iframe.src = `${streamingViewPageUrl}?reload=${Date.now()}`
					}
				},
			})
		}
	}
	else return false

	store.messages.lastMessageId = null
	refreshChannelPinsBar()
	return true
}
