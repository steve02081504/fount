/**
 * 创建新聊天的页面逻辑。
 */
import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'
import { currentChatId, createNewChat, addCharacter } from '../src/endpoints.mjs'

/**
 * 初始化页面，创建一个新的聊天会话，根据 URL 参数添加一个角色（如果提供），然后重定向到主聊天页面。
 * @returns {Promise<void>}
 */
async function main() {
	await initTranslations('chat.new')
	applyTheme()

	try {
		await createNewChat()
		const searchParams = new URLSearchParams(window.location.search)
		const charToAdd = searchParams.get('char')
		if (charToAdd) await addCharacter(charToAdd)
	}
	catch (e) {
		console.error(e)
		showToast('error', e.stack || e.message || e)
		throw e
	}

	window.history.replaceState(null, null, '/parts/shells:chat/#' + currentChatId)
	window.location = '/parts/shells:chat/#' + currentChatId
	window.location.reload()
}
main()
