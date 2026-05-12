/**
 * 聊天 shell 根路径：经典单页 UI 已移除，统一进入 Hub（Discord 式）。
 * 仅保留 `#group:groupId:channelId` 等 Hub 约定 hash。
 */
import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

/**
 *
 */
async function init() {
	applyTheme()
	await initTranslations('chat')
	const h = window.location.hash
	window.location.replace(`/parts/shells:chat/hub/${h}`)
}

void init()
