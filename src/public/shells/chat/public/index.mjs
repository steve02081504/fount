/**
 * @file chat/public/index.mjs
 * @description 聊天页面的入口点。
 * @namespace chat.public
 */
import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { initializeChat } from './src/chat.mjs'

/**
 * @function init
 * @memberof chat.public
 * @description 初始化聊天页面，包括主题、翻译和聊天功能。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('chat')
	usingTemplates('/shells/chat/src/templates')
	await initializeChat()
}

init()
