/**
 * 聊天页面的入口点。
 */
import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { initializeChat } from './src/chat.mjs'

/**
 * 初始化聊天页面，包括主题、翻译和聊天功能。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('chat')
	usingTemplates('/parts/shells:chat/src/templates')
	await initializeChat()
}

init()
