/**
 * 生成器附加界面动态导入回归：display.mjs 以 `parturl` 为基准 `import(...)` 同目录模块，
 * 该 URL 必须是绝对地址，否则会在 async_eval 的模块基准上被错误解析而加载失败。
 */
import { test, expect } from './fixtures.mjs'

const SOURCE_NAME = 'test-proxy-source'
const MODELS_DEV_API = 'https://models.dev/api.json'
const CATALOG = {
	openai: {
		id: 'openai',
		name: 'OpenAI',
		api: 'https://api.openai.com/v1',
		models: {
			'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
		},
	},
}

test.describe('Service source manager generator display', () => {
	test('display module imports its sibling part module by absolute parturl', async ({ page, baseUrl }) => {
		await page.route(MODELS_DEV_API, route => route.fulfill({
			status: 200,
			headers: {
				'content-type': 'application/json',
				'access-control-allow-origin': '*',
			},
			body: JSON.stringify(CATALOG),
		}))

		await page.goto(
			`${baseUrl}/parts/shells:serviceSourceManage/?file=${SOURCE_NAME}&sourcePath=serviceSources%2FAI`,
			{ waitUntil: 'domcontentloaded' },
		)

		const display = page.locator('#generatorDisplay')
		await expect(display.locator('[data-search-input]')).toBeVisible()
		await expect(display).not.toContainText('Failed to fetch dynamically imported module')
	})
})
