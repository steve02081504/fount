/**
 * 【文件】public/hub/sidebar/channelDisplayName.mjs
 * 【职责】频道展示名：有名字用名字，空名显示本地化"未命名"。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * @param {{ name?: string }} [channel] 频道元数据
 * @returns {string} 展示名（空名回退"未命名"）
 */
export function channelDisplayName(channel) {
	const name = channel?.name
	return name && name.trim() ? name : geti18n('chat.hub.channel.unnamed')
}
