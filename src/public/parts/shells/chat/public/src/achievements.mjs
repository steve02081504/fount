import { unlockAchievement } from '../../../../../scripts/parts.mjs'

/** 初始化聊天 shell 的成就系统，注册相关事件监听。 */
export async function initializeAchievements() {
	// Listener for code execution achievement
	window.addEventListener('markdown-codeblock-execution-result', (event) => {
		if (event.detail?.output?.toLowerCase().includes('hello fount'))
			unlockAchievement('shells/chat', 'code_greeting')
	})
}
