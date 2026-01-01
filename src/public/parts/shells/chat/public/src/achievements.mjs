import { unlockAchievement } from '../../../../../scripts/parts.mjs'

/**
 * Initializes the achievement system.
 */
export async function initializeAchievements() {
	// Listener for code execution achievement
	window.addEventListener('markdown-codeblock-execution-result', (event) => {
		if (event.detail?.output?.toLowerCase().includes('hello fount'))
			unlockAchievement('shells/chat', 'code_greeting')
	})
}
