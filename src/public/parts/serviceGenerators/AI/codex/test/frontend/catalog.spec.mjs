/**
 * Codex 服务源：目录请求使用局部 HTTP mock，源文件只含合成凭证。
 */
import { expect, test } from './fixtures.mjs'

const SOURCE = 'test-codex-source'
const ENDPOINT = '**/api/parts/serviceGenerators:AI:codex/models?*'
const MODELS = {
	models: [
		{ slug: 'model-a', displayName: 'Model A', defaultReasoningLevel: 'medium', supportedReasoningLevels: ['low', 'high', 'ultra'] },
		{ slug: 'model-b', displayName: 'Model B', defaultReasoningLevel: 'low', supportedReasoningLevels: ['low'] },
	],
}

/**
 * 经管理页保存设置后读回服务源的非凭证字段。
 * @param {import('@playwright/test').Page} page - 测试页面。
 * @returns {Promise<{model: string, model_arguments: object}>} 保存结果。
 */
async function saveAndRead(page) {
	await Promise.all([
		page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`shells:serviceSourceManage/AI/${SOURCE}`) && response.ok()),
		page.locator('#saveButton').click(),
	])
	return page.evaluate(async () => {
		const { getServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
		const source = await getServiceSourceFile('test-codex-source', 'serviceSources/AI')
		return { model: source.config.model, model_arguments: source.config.model_arguments }
	})
}

test('模型与推理强度选项不丢失手填值和其他模型参数', async ({ page, baseUrl }) => {
	await page.route(ENDPOINT, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) }))
	const url = `${baseUrl}/parts/shells:serviceSourceManage/?file=${SOURCE}&sourcePath=serviceSources%2FAI`
	const catalogUrl = `${baseUrl}/api/parts/serviceGenerators:AI:codex/models?sourceName=${SOURCE}`
	await page.goto(url, { waitUntil: 'domcontentloaded' })

	const anonymous = await page.context().browser().newContext()
	try {
		const denied = await anonymous.request.get(catalogUrl, { headers: { Accept: 'application/json' }, maxRedirects: 0 })
		expect(denied.status()).toBe(401)
	}
	finally {
		await anonymous.close()
	}
	const wrongSource = await page.request.get(catalogUrl.replace(SOURCE, 'not-a-source'))
	expect(wrongSource.status()).toBe(400)

	const model = page.locator('[data-codex-model-select]')
	const effort = page.locator('[data-codex-effort-select]')
	const warning = page.locator('[data-i18n="serviceSource_manager.common_config_interface.unsupportedEffort"]')
	await expect(model).toHaveValue('custom-existing-model')
	await expect(effort).toHaveValue('high')

	await model.selectOption('model-b')
	await expect(effort).toHaveValue('high')
	await expect(warning).toBeVisible()
	expect(await saveAndRead(page)).toEqual({ model: 'model-b', model_arguments: { temperature: 0.4, reasoning: { effort: 'high', summary: 'auto' } } })

	await model.selectOption('model-a')
	await expect(effort.locator('option[value="ultra"]')).toHaveCount(1)
	await effort.selectOption('ultra')
	expect(await saveAndRead(page)).toEqual({ model: 'model-a', model_arguments: { temperature: 0.4, reasoning: { effort: 'ultra', summary: 'auto' } } })

	await effort.selectOption('')
	expect(await saveAndRead(page)).toEqual({ model: 'model-a', model_arguments: { temperature: 0.4, reasoning: { summary: 'auto' } } })

	// 页面读取旧配置后，模拟服务端在目录请求期间更新 OAuth；修改强度不应把旧凭证写回。
	await page.unroute(ENDPOINT)
	await page.route(ENDPOINT, async route => {
		const sourceUrl = `${baseUrl}/api/parts/shells:serviceSourceManage/AI/${SOURCE}`
		const source = await (await page.request.get(sourceUrl)).json()
		source.config.oauth.access = 'synthetic-rotated-access'
		await page.request.post(sourceUrl, { data: source })
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
	})
	await page.reload({ waitUntil: 'domcontentloaded' })
	await expect(effort).toHaveValue('')
	await effort.selectOption('high')
	await saveAndRead(page)
	const oauthPreserved = await page.evaluate(async () => {
		const { getServiceSourceFile } = await import('/parts/shells:serviceSourceManage/src/endpoints.mjs')
		return (await getServiceSourceFile('test-codex-source', 'serviceSources/AI')).config.oauth.access === 'synthetic-rotated-access'
	})
	expect(oauthPreserved).toBe(true)

	await page.unroute(ENDPOINT)
	await page.route(ENDPOINT, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Catalog unavailable"}' }))
	await page.reload({ waitUntil: 'domcontentloaded' })
	await expect(page.locator('#generatorDisplay')).toContainText('Catalog unavailable')
	await expect(page.locator('#jsonEditor')).toContainText('model-a')

	await page.unroute(ENDPOINT)
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
