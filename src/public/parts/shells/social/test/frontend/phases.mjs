/**
 * Social 前端测试阶段定义（供 Deno 测试框架和 Playwright Node 配置双重读取）。
 * 此文件不得引用任何 npm 包，以保持 Deno / Node 双重可导入性。
 */

/**
 * @type {Array<{ name: string, testMatch: string[] }>}
 */
export const phases = [
	{ name: 'smoke', testMatch: ['smoke.spec.mjs'] },
	{
		name: 'actions',
		testMatch: ['postActions.spec.mjs', 'replies.spec.mjs', 'postDetail.spec.mjs'],
	},
	{
		// composer 含 Chat 群关联，单独阶段避免拖垮后续 deepLink/feed 节点
		name: 'composer',
		testMatch: ['composer.spec.mjs'],
	},
	{
		name: 'core',
		testMatch: ['deepLink.spec.mjs', 'feed.spec.mjs', 'navigation.spec.mjs', 'profile.spec.mjs', 'saved.spec.mjs', 'drafts.spec.mjs', 'videos.spec.mjs'],
	},
	{
		name: 'tail',
		testMatch: ['explore_notifications.spec.mjs'],
	},
]
