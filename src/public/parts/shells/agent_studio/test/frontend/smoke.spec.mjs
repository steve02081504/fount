/**
 * Agent Studio 前端冒烟：命名导出客户端、跨运行时生成链纯函数与模板渲染在真实浏览器里可加载，
 * 并实际启动页面壳、验证视图切换。
 */
import { test, expect } from './fixtures.mjs'

const ENDPOINT_EXPORTS = [
	'listChars',
	'getCharOverview',
	'listSubAgents',
	'listGenerations',
	'getGeneration',
	'listChains',
	'getRetention',
	'setRetention',
	'listBenchmarks',
	'getBenchmark',
	'createBenchmark',
	'updateBenchmark',
	'deleteBenchmark',
	'runBenchmark',
	'listRuns',
	'getRun',
]

/**
 * 打开 Agent Studio 首页并等待 shell bootstrap 就绪。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {string} baseUrl 测试根 URL
 * @returns {Promise<void>}
 */
async function openAgentStudio(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:agent_studio/`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(
		() => globalThis.fount?.test?.getState?.('agent-studio')?.status === 'ready',
		null,
		{ timeout: 90_000 },
	)
}

test.describe('Agent Studio frontend modules', () => {
	test('frontend endpoint client exposes the full named-export surface', async ({ modulePage }) => {
		const exported = await modulePage.run(async () => {
			const mod = await import('/parts/shells:agent_studio/src/endpoints.mjs')
			return Object.fromEntries(Object.entries(mod).map(([name, value]) => [name, typeof value]))
		})
		for (const name of ENDPOINT_EXPORTS)
			expect(exported[name], `${name} should be exported`).toBe('function')
	})

	test('shared generationChain groups and links records in-browser', async ({ modulePage }) => {
		const shape = await modulePage.run(async () => {
			const { groupByConversation, buildChains } = await import('/parts/shells:agent_studio/shared/generationChain.mjs')
			const roots = buildChains([{ id: 'a' }, { id: 'b', parentId: 'a' }])
			const groups = groupByConversation([{ id: '1', conversationId: 'c' }, { id: '2' }])
			return {
				rootIds: roots.map(node => node.record.id),
				childIds: roots[0].children.map(node => node.record.id),
				groupKeys: [...groups.keys()],
			}
		})
		expect(shape.rootIds).toEqual(['a'])
		expect(shape.childIds).toEqual(['b'])
		expect(shape.groupKeys).toEqual(['c', ''])
	})

	test('renders a list template through templatesFor', async ({ modulePage }) => {
		const html = await modulePage.run(async () => {
			const { renderTemplateAsHtmlString } = await import('/parts/shells:agent_studio/src/templates.mjs')
			return await renderTemplateAsHtmlString('char_item', {
				id: 'demo',
				avatar: '/favicon.svg',
				name: 'Demo',
				description: 'desc',
			})
		})
		expect(html).toContain('data-char-id="demo"')
		expect(html).toContain('Demo')
		expect(html).toContain('desc')
	})
})

test.describe('Agent Studio shell boot', () => {
	test('boots into the dashboard shell and switches views', async ({ page, baseUrl }) => {
		await openAgentStudio(page, baseUrl)
		await expect(page.locator('.side-nav .nav-btn[data-view="dashboard"]')).toBeVisible()
		await expect(page.locator('#dashboardView')).toBeVisible()

		await page.locator('.side-nav .nav-btn[data-view="generations"]').click()
		await expect(page.locator('#generationsView')).toBeVisible()
		await expect(page.locator('#dashboardView')).toBeHidden()

		await page.locator('.side-nav .nav-btn[data-view="benchmarks"]').click()
		await expect(page.locator('#benchmarksView')).toBeVisible()

		await page.locator('.side-nav .nav-btn[data-view="settings"]').click()
		await expect(page.locator('#settingsView')).toBeVisible()
		await expect(page.locator('#retentionSave')).toBeVisible()
	})
})
