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

	test('Codex model and reasoning pickers keep custom IDs and other JSON settings', async ({ page, baseUrl }) => {
		const endpoint = '**/api/parts/shells:oauth_handler/codex/models?*'
		const url = `${baseUrl}/parts/shells:serviceSourceManage/?file=test-codex-source&sourcePath=serviceSources%2FAI`
		await page.goto(url, { waitUntil: 'domcontentloaded' })
		const catalogUrl = `${baseUrl}/api/parts/shells:oauth_handler/codex/models?sourceName=test-codex-source`
		const response = await page.request.get(catalogUrl)
		expect(response.status()).toBe(200)
		const catalog = await response.json()
		expect(catalog.models.map(model => model.slug)).toEqual(['model-a', 'model-b'])
		expect(catalog.models[0].supportedReasoningLevels).toEqual(['low', 'high', 'ultra'])
		expect(JSON.stringify(catalog).includes('synthetic-ui-token')).toBe(false)
		const wrongSource = await page.request.get(catalogUrl.replace('test-codex-source', 'test-proxy-source'))
		expect(wrongSource.status()).toBe(400)
		const anonymous = await page.context().browser().newContext()
		try {
			const unauthorized = await anonymous.request.get(catalogUrl, { headers: { Accept: 'application/json' }, maxRedirects: 0 })
			expect(unauthorized.status()).toBe(401)
		}
		finally {
			await anonymous.close()
		}
		const model = page.locator('[data-codex-model-select]')
		const effort = page.locator('[data-codex-effort-select]')
		const warning = page.locator('[data-i18n="serviceSource_manager.common_config_interface.codexModelPicker.unsupportedEffort"]')
		await expect(model).toBeVisible()
		await expect(model).toHaveValue('custom-existing-model')
		await expect(effort).toHaveValue('high')

		await model.selectOption('model-b')
		await expect(effort).toHaveValue('high')
		await expect(warning).toBeVisible()
		await Promise.all([
			page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('shells:serviceSourceManage/AI/test-codex-source') && response.ok()),
			page.locator('#saveButton').click(),
		])
		const afterModelChange = await page.evaluate(async () => {
			const { getServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
			const source = await getServiceSourceFile('test-codex-source', 'serviceSources/AI')
			return { model: source.config.model, model_arguments: source.config.model_arguments }
		})
		expect(afterModelChange.model).toBe('model-b')
		expect(afterModelChange.model_arguments).toEqual({ temperature: 0.4, reasoning: { effort: 'high', summary: 'auto' } })

		await model.selectOption('model-a')
		await expect(effort.locator('option[value="ultra"]')).toHaveCount(1)
		await effort.selectOption('ultra')
		await Promise.all([
			page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('shells:serviceSourceManage/AI/test-codex-source') && response.ok()),
			page.locator('#saveButton').click(),
		])
		const afterEffortChange = await page.evaluate(async () => {
			const { getServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
			const source = await getServiceSourceFile('test-codex-source', 'serviceSources/AI')
			return { model: source.config.model, model_arguments: source.config.model_arguments }
		})
		expect(afterEffortChange.model).toBe('model-a')
		expect(afterEffortChange.model_arguments).toEqual({ temperature: 0.4, reasoning: { effort: 'ultra', summary: 'auto' } })

		await effort.selectOption('')
		await Promise.all([
			page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('shells:serviceSourceManage/AI/test-codex-source') && response.ok()),
			page.locator('#saveButton').click(),
		])
		const afterDefault = await page.evaluate(async () => {
			const { getServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
			const source = await getServiceSourceFile('test-codex-source', 'serviceSources/AI')
			return source.config.model_arguments
		})
		expect(afterDefault).toEqual({ temperature: 0.4, reasoning: { summary: 'auto' } })

		await page.route(endpoint, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Catalog unavailable"}' }))
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(page.locator('#generatorDisplay')).toContainText('Catalog unavailable')
		await expect(page.locator('#jsonEditor')).toContainText('model-a')

		await page.unroute(endpoint)
		await page.evaluate(async () => {
			const { getServiceSourceFile, setServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
			const source = await getServiceSourceFile('test-codex-source', 'serviceSources/AI')
			delete source.config.oauth
			source.config.model = 'manual-still-here'
			await setServiceSourceFile('test-codex-source', source, 'serviceSources/AI')
		})
		const noLogin = await page.request.get(catalogUrl)
		expect(noLogin.status()).toBe(409)
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(page.locator('#jsonEditor')).toContainText('manual-still-here')
		await expect(page.locator('#generatorDisplay [data-i18n="serviceSource_manager.common_config_interface.oauth.notLoggedIn"]')).toBeVisible()
	})
})
