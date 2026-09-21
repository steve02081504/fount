/**
 * Agent Studio 前端冒烟：命名导出客户端、跨运行时生成链纯函数与模板渲染在真实浏览器里可加载。
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
