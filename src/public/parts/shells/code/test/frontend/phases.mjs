/**
 * Playwright 测试阶段配置。
 * @type {Array<{ name: string, testMatch: string[] }>}
 */
export const phases = [
	{
		name: 'smoke',
		testMatch: [
			'smoke.spec.mjs',
			'composer.spec.mjs',
			'pill_dropdowns.spec.mjs',
			'sessions.spec.mjs',
			'tabs.spec.mjs',
			'messages.spec.mjs',
			'gist_mention.spec.mjs',
			'power_actions.spec.mjs',
			'composer_chrome.spec.mjs',
			'composer_keyboard.spec.mjs',
			'home_picker_search.spec.mjs',
			'workspace_pill_search.spec.mjs',
			'notifications.spec.mjs',
			'tool_cards.spec.mjs',
			'stream_render.spec.mjs',
		],
	},
]
