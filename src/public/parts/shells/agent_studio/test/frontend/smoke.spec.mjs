/**
 * Agent Studio 前端冒烟：命名导出客户端、跨运行时生成链纯函数与模板渲染在真实浏览器里可加载，
 * 并实际启动页面壳、验证视图切换。
 */
import { test, expect } from './fixtures.mjs'

const ENDPOINT_EXPORTS = [
	'listChars',
	'getCharOverview',
	'listSubAgents',
	'getSubAgent',
	'sendSubAgentMessage',
	'listGenerations',
	'getGeneration',
	'clearGenerations',
	'listConversations',
	'getConversation',
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

	test('buildRoundUnits expands generations into one unit per round', async ({ modulePage }) => {
		const units = await modulePage.run(async () => {
			const { buildRoundUnits } = await import('/parts/shells:agent_studio/src/views/conversation.mjs')
			return buildRoundUnits([
				{ id: 'a', requestCount: 4, requests: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }] },
				{ id: 'b', requestCount: 1, requests: [{ index: 1 }] },
			])
		})
		expect(units.map(unit => unit.round)).toEqual([1, 2, 3, 4, 5])
		expect(units.map(unit => unit.generationIndex)).toEqual([0, 0, 0, 0, 1])
		expect(units.filter(unit => unit.generationStart).map(unit => unit.round)).toEqual([1, 5])
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

	test('deep-links to the sub-agent conversation through the hash', async ({ page, baseUrl }) => {
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/subagent%3Aunknown-run-id' })
		await expect(page.locator('#conversationView')).toBeVisible()
		await expect(page.locator('#conversationSubagent')).toBeVisible()
		await expect(page.locator('#dashboardView')).toBeHidden()
		await page.locator('#conversationBackButton').click()
		await expect(page.locator('#generationsView')).toBeVisible()
		await expect(page.locator('#conversationView')).toBeHidden()
	})

	test('deep-links to the conversation view through the hash', async ({ page, baseUrl }) => {
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/unknown-key' })
		await expect(page.locator('#conversationView')).toBeVisible()
		await expect(page.locator('#dashboardView')).toBeHidden()
		await page.locator('#conversationBackButton').click()
		await expect(page.locator('#generationsView')).toBeVisible()
		await expect(page.locator('#conversationView')).toBeHidden()
	})

	test('conversation replay exposes per-generation cache estimates and Markdown/plain-text messages', async ({ page, baseUrl }) => {
		const generations = [1, 2].map(index => ({
			id: `g${index}`, startedAt: 1000 * index, source: 'shells/code', charId: 'demo',
			requestCount: 1, requests: [{ index: 1, systemPrompt: 'An instruction shared across requests', messages: [{ role: 'user', id: 'user-1', content: 'hello' }] }],
			dialogue: { events: [{ round: 1, op: 'insert', message: { id: `m${index}`, role: 'char', content: `**reply ${index}**` } }] },
			response: `**reply ${index}**`,
		}))
		await page.route('**/api/parts/shells:agent_studio/conversation/demo-replay', route => route.fulfill({
			json: {
				key: 'demo-replay', generations,
				dialogue: { events: generations.map((generation, index) => ({ ...generation.dialogue.events[0], round: index + 1 })) },
			}
		}))
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/demo-replay' })
		await expect(page.locator('#conversationGenerations .conversation-generation')).toHaveCount(2)
		await expect(page.locator('#conversationGenerations .conversation-generation-head .badge-success')).toHaveCount(3)

		const actions = page.locator('#conversationGenerations .conversation-generation > .conversation-section .section-actions').first()
		await expect(actions).toBeVisible()
		const downloadPromise = page.waitForEvent('download')
		await actions.getByRole('button').nth(1).click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toBe('generation-g1-response.txt')
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
		await actions.getByRole('button').first().click()
		const clipboard = await page.evaluate(() => navigator.clipboard.readText())
		expect(clipboard).toContain('reply 1')

		await page.locator('#conversationReplaySlider').fill('1')
		await expect(page.locator('#conversationGenerations .conversation-generation')).toHaveCount(1)
		await expect(page.locator('#conversationTranscript .conversation-message')).toHaveCount(1)
		const body = page.locator('#conversationTranscript .message-view').first()
		await expect(body.locator('strong')).toHaveText('reply 1')
		await body.locator('button').click()
		await expect(body.locator('pre')).toContainText('**reply 1**')
		await expect(page.locator('#conversationReplaySlider')).toHaveAttribute('min', '1')
		await expect(page.locator('#conversationReplaySlider')).toHaveValue('1')
	})

	test('conversation timeline lists one node per round across multi-round generations', async ({ page, baseUrl }) => {
		const generations = [
			{ id: 'g1', startedAt: 1000, source: 'shells/code', charId: 'demo', requestCount: 4, requests: [1, 2, 3, 4].map(index => ({ index, systemPrompt: 'shared', messages: [{ role: 'user', id: 'user-1', content: 'hello' }] })), dialogue: { rounds: 4, events: [1, 2, 3, 4].map(round => ({ round, op: 'insert', message: { id: `a${round}`, role: 'char', content: `round ${round}` } })) }, response: 'round 4' },
			{ id: 'g2', startedAt: 2000, source: 'shells/code', charId: 'demo', requestCount: 1, requests: [{ index: 1, systemPrompt: 'shared', messages: [{ role: 'user', id: 'user-1', content: 'hello' }] }], dialogue: { rounds: 1, events: [{ round: 1, op: 'insert', message: { id: 'b1', role: 'char', content: 'final' } }] }, response: 'final' },
		]
		await page.route('**/api/parts/shells:agent_studio/conversation/demo-rounds', route => route.fulfill({
			json: {
				key: 'demo-rounds', generations,
				dialogue: { events: [...generations[0].dialogue.events, { ...generations[1].dialogue.events[0], round: 5 }] },
			}
		}))
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/demo-rounds' })
		await expect(page.locator('#conversationTimeline .conversation-timeline-node')).toHaveCount(5)
		await expect(page.locator('#conversationTimeline .conversation-timeline-node').first()).toHaveText('1')
		await expect(page.locator('#conversationTimeline .conversation-timeline-node').last()).toHaveText('5')
		await expect(page.locator('#conversationReplaySlider')).toHaveAttribute('max', '5')
		// 回放到第 1 轮只显示第一条生成，且展示会话转录中该轮的消息
		await page.locator('#conversationReplaySlider').fill('1')
		await expect(page.locator('#conversationGenerations .conversation-generation')).toHaveCount(1)
		await expect(page.locator('#conversationTranscript .conversation-message')).toHaveCount(1)
		// 回放到第 2 轮仍属于同一生成
		await page.locator('#conversationReplaySlider').fill('2')
		await expect(page.locator('#conversationGenerations .conversation-generation')).toHaveCount(1)
		await expect(page.locator('#conversationTranscript .conversation-message')).toHaveCount(2)
		// 回放到最后一轮显示两条生成
		await page.locator('#conversationReplaySlider').fill('5')
		await expect(page.locator('#conversationGenerations .conversation-generation')).toHaveCount(2)
	})

	test('live sub-agent composer accepts a user message only at the latest replay node', async ({ page, baseUrl }) => {
		const entries = [{ role: 'system', name: 'system', content: 'task started' }]
		await page.route('**/api/parts/shells:agent_studio/subagent/live-run', route => route.fulfill({
			json: {
				runId: 'live-run', state: 'running', rounds: 1, roundLimit: 3, task: 'demo task',
				conversation: entries, canSend: true,
			}
		}))
		await page.route('**/api/parts/shells:agent_studio/conversation/subagent%3Alive-run', route => {
			const generations = [1, 2].map(index => ({
				id: `g${index}`, startedAt: 1000 * index, source: 'shells/code', charId: 'demo',
				requestCount: 1, requests: [{ index: 1, systemPrompt: 'shared', messages: [{ role: 'user', id: 'user-1', content: 'hello' }] }],
				dialogue: { events: [{ round: index, op: 'insert', message: { id: `m${index}`, role: 'char', content: `reply ${index}` } }] },
				response: `reply ${index}`,
			}))
			return route.fulfill({ json: { key: 'subagent:live-run', generations, dialogue: { events: generations.map(generation => generation.dialogue.events[0]) } } })
		})
		await page.route('**/api/parts/shells:agent_studio/subagent/live-run/messages', async route => {
			const body = route.request().postDataJSON()
			entries.push({ role: 'user', name: 'alice', content: body.content })
			await route.fulfill({ status: 201, json: entries.at(-1) })
		})
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/subagent%3Alive-run' })
		await expect(page.locator('#subagentMessageForm')).toBeVisible()
		await page.locator('#conversationReplaySlider').fill('1')
		await expect(page.locator('#subagentMessageForm')).toBeHidden()
		await page.locator('#conversationReplaySlider').fill('2')
		await page.locator('#subagentMessageInput').fill('new instruction')
		await page.locator('#subagentMessageForm button').click()
		await expect(page.locator('#subagentTranscript')).toContainText('new instruction')
	})
})
