/**
 * 【文件】public/src/achievements.mjs
 * 【职责】chat shell 前端成就钩子：监听 Markdown 代码块执行等并解锁对应成就。
 * 【原理】initializeAchievements 注册 window 事件监听，满足条件时 unlockAchievement(parts API)。
 * 【数据结构】无持久模块状态；事件 detail 由 markdown 渲染器发出。
 * 【关联】@pages/scripts/api/parts.mjs；chatMarkdown 代码块执行。
 */
import { unlockAchievement } from '../../../scripts/api/parts.mjs'

/** 初始化聊天 shell 的成就系统，注册相关事件监听。 */
export async function initializeAchievements() {
	// Listener for code execution achievement
	window.addEventListener('markdown-codeblock-execution-result', (event) => {
		if (event.detail?.output?.toLowerCase().includes('hello fount'))
			unlockAchievement('shells/chat', 'code_greeting')
	})
}
