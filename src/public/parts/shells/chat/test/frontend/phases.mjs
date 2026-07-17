/**
 * Chat 前端测试阶段定义（供 Deno 测试框架和 Playwright Node 配置双重读取）。
 * 此文件不得引用任何 npm 包，以保持 Deno / Node 双重可导入性。
 */

/**
 * @type {Array<{ name: string, testMatch: string | string[] }>}
 */
export const phases = [
	{ name: 'shell', testMatch: ['smoke.spec.mjs'] },
	{ name: 'deeplink', testMatch: ['deepLink.spec.mjs'] },
	{
		name: 'hub-ui',
		testMatch: [
			'composer.spec.mjs',
			'navigation.spec.mjs',
			'messageActions.spec.mjs',
			'unread.spec.mjs',
			'inbox.spec.mjs',
			'mobilePane.spec.mjs',
		],
	},
	{ name: 'hub', testMatch: ['hubE2E.spec.mjs'] },
	{ name: 'secondary', testMatch: ['secondaryPages.spec.mjs'] },
	{ name: 'profile', testMatch: ['profile.spec.mjs'] },
]
