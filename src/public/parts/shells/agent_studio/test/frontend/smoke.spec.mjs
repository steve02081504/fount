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
			dialogue: { events: [{ round: 1, op: 'insert', message: { id: `g${index}:final`, role: 'char', content: `**reply ${index}**` } }] },
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
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(2)
		await expect(page.locator('#conversationGenerations .conversation-entry-meta .badge-success')).toHaveCount(1)
		await expect(page.locator('#conversationGenerations .conversation-entry-meta .badge-neutral')).toHaveCount(1)

		const actions = page.locator('#conversationGenerations .conversation-entry-meta .section-actions').first()
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
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(1)
		const body = page.locator('#conversationGenerations .conversation-entry .message-view').first()
		await expect(body.locator('pre')).toContainText('**reply 1**')
		await body.locator('button').click()
		await expect(body.locator('strong')).toHaveText('reply 1')
		await expect(page.locator('#conversationReplaySlider')).toHaveAttribute('min', '1')
		await expect(page.locator('#conversationReplaySlider')).toHaveValue('1')
	})

	test('highlights prompt text reused from the previous round and jumps to the reuse boundary', async ({ page, baseUrl }) => {
		const shared = 'S'.repeat(70)
		const generations = [{
			id: 'g1', startedAt: 1000, source: 'shells/code', charId: 'demo', requestCount: 2,
			requests: [
				{ index: 1, systemPrompt: `${shared}A`, messages: [{ role: 'user', id: 'u1', content: 'hello' }] },
				{ index: 2, systemPrompt: `${shared}B`, messages: [{ role: 'user', id: 'u1', content: 'hello' }, { role: 'char', id: 'a1', content: 'first answer' }] },
			],
			dialogue: { rounds: 2, events: [
				{ round: 1, op: 'insert', message: { id: 'u1', role: 'user', content: 'hello' } },
				{ round: 1, op: 'insert', message: { id: 'a1', role: 'char', content: 'first answer' } },
				{ round: 2, op: 'insert', message: { id: 'g1:final', role: 'char', content: 'final' } },
			] },
			response: 'final',
		}]
		await page.route('**/api/parts/shells:agent_studio/conversation/demo-reuse', route => route.fulfill({
			json: { key: 'demo-reuse', generations, dialogue: { events: generations[0].dialogue.events } },
		}))
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/demo-reuse' })
		await expect(page.locator('#conversationReplaySlider')).toHaveValue('2')
		const rounds = page.locator('#conversationGenerations .conversation-entry.role-char')
		// 首轮没有上一轮基准：无复用高亮、无跳转按钮。
		await expect(rounds.nth(0).locator('.prompt-reused')).toHaveCount(0)
		await expect(rounds.nth(0).locator('.conversation-jump')).toHaveCount(0)
		await expect(rounds.nth(0).locator('[data-prompt-boundary]')).toHaveCount(0)
		// 次轮系统提示在第 71 个字符处不同：只高亮公共的 70 字符，分界线落在条目内部，其后消息不再泛绿。
		const second = rounds.nth(1)
		const systemSection = second.locator('.conversation-request > .conversation-section').first()
		await expect(systemSection.locator('.prompt-reused')).toHaveText('S'.repeat(70))
		await expect(systemSection.locator('[data-prompt-boundary]')).toHaveCount(1)
		await expect(second.locator('.conversation-message .prompt-reused')).toHaveCount(0)
		const jump = second.locator('.conversation-jump')
		await expect(jump).toBeVisible()
		const details = second.locator('.conversation-requests')
		await expect(details).not.toHaveAttribute('open', '')
		await jump.click()
		await expect(details).toHaveAttribute('open', '')
	})

	test('collapses tool output longer than seven lines by default', async ({ page, baseUrl }) => {
		const longTool = Array.from({ length: 12 }, (_, index) => `tool line ${index + 1}`).join('\n')
		const shortTool = Array.from({ length: 7 }, (_, index) => `short line ${index + 1}`).join('\n')
		const generations = [{
			id: 'g1', startedAt: 1000, source: 'shells/code', charId: 'demo', requestCount: 1,
			requests: [{ index: 1, systemPrompt: 'sys', messages: [{ role: 'user', id: 'u1', content: 'hello' }] }],
			dialogue: {
				rounds: 1, events: [
					{ round: 1, op: 'insert', message: { id: 'long', role: 'tool', content: longTool } },
					{ round: 1, op: 'insert', message: { id: 'short', role: 'tool', content: shortTool } },
					{ round: 1, op: 'insert', message: { id: 'g1:final', role: 'char', content: 'done' } },
				]
			},
			response: 'done',
		}]
		await page.route('**/api/parts/shells:agent_studio/conversation/demo-tool-collapse', route => route.fulfill({
			json: { key: 'demo-tool-collapse', generations, dialogue: { events: generations[0].dialogue.events } },
		}))
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/demo-tool-collapse' })
		const rows = page.locator('#conversationGenerations .conversation-entry > .conversation-message.role-tool')
		const longRow = rows.filter({ hasText: 'tool line 12' })
		await expect(longRow.locator('.message-view-plain')).toHaveClass(/is-collapsed/)
		const toggle = longRow.locator('.message-collapse-toggle')
		await expect(toggle).toBeVisible()
		await toggle.click()
		await expect(longRow.locator('.message-view-plain')).not.toHaveClass(/is-collapsed/)
		await expect(rows.filter({ hasText: 'short line 7' }).locator('.message-collapse-toggle')).toHaveCount(0)
	})

	test('replay keeps one conversation history and expands prompts on model outputs only', async ({ page, baseUrl }) => {
		const requests = [
			{ index: 1, systemPrompt: 'instruction', messages: [{ id: 'user', role: 'user', content: 'question' }] },
			{ index: 2, systemPrompt: 'instruction', messages: [{ id: 'user', role: 'user', content: 'question' }, { id: 'reply', role: 'char', content: 'first reply' }] },
		]
		await page.route('**/api/parts/shells:agent_studio/conversation/deduplicated', route => route.fulfill({ json: {
			key: 'deduplicated', generations: [{ id: 'gen', startedAt: 1000, requestCount: 2, requests, response: 'second reply' }],
			dialogue: { events: [
				{ round: 1, op: 'insert', message: { id: 'user', role: 'user', content: 'question' } },
				{ round: 1, op: 'insert', message: { id: 'reply', role: 'char', content: 'first reply' } },
				{ round: 2, op: 'insert', message: { id: 'gen:final', role: 'char', content: 'second reply' } },
			] },
		} }))
		await openAgentStudio(page, baseUrl)
		await page.evaluate(() => { window.location.hash = '#conversation/deduplicated' })
		await expect(page.locator('#conversationGenerations .conversation-entry.role-user')).toHaveCount(1)
		await expect(page.locator('#conversationGenerations .conversation-entry.role-char')).toHaveCount(2)
		await expect(page.locator('#conversationGenerations .conversation-requests')).toHaveCount(2)
		await page.locator('#conversationReplaySlider').fill('1')
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(2)
		await expect(page.locator('#conversationGenerations')).not.toContainText('second reply')
	})

	test('conversation timeline lists one node per round across multi-round generations', async ({ page, baseUrl }) => {
		const generations = [
			{ id: 'g1', startedAt: 1000, source: 'shells/code', charId: 'demo', requestCount: 4, requests: [1, 2, 3, 4].map(index => ({ index, systemPrompt: `instruction ${index}`, messages: [{ role: 'user', id: 'user-1', content: `question ${index}` }] })), dialogue: { rounds: 4, events: [1, 2, 3, 4].map(round => ({ round, op: 'insert', message: { id: round === 4 ? 'g1:final' : `a${round}`, role: 'char', content: `round ${round}` } })) }, response: 'round 4' },
			{ id: 'g2', startedAt: 2000, source: 'shells/code', charId: 'demo', requestCount: 1, requests: [{ index: 1, systemPrompt: 'shared', messages: [{ role: 'user', id: 'user-1', content: 'hello' }] }], dialogue: { rounds: 1, events: [{ round: 1, op: 'insert', message: { id: 'g2:final', role: 'char', content: 'final' } }] }, response: 'final' },
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
		// 回放到第 1 轮即可看到本轮结果、缓存和该轮 prompt，但没有后续轮次。
		await page.locator('#conversationReplaySlider').fill('1')
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(1)
		await expect(page.locator('#conversationGenerations .conversation-entry > .conversation-message')).toContainText('round 1')
		await expect(page.locator('#conversationGenerations .conversation-entry-meta .badge')).toHaveCount(1)
		await expect(page.locator('#conversationGenerations .conversation-request')).toHaveCount(1)
		await page.locator('#conversationGenerations .conversation-entry .conversation-requests').first().click()
		await expect(page.locator('#conversationGenerations .conversation-entry').first()).toContainText('instruction 1')
		await expect(page.locator('#conversationGenerations')).not.toContainText('round 2')
		await expect(page.locator('#conversationGenerations')).not.toContainText('instruction 4')
		// 回放到第 2 轮仍属于同一生成
		await page.locator('#conversationReplaySlider').fill('2')
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(2)
		await expect(page.locator('#conversationGenerations .conversation-entry').nth(1)).toContainText('round 2')
		await expect(page.locator('#conversationGenerations .conversation-entry').nth(1).locator('.badge')).toHaveCount(1)
		await expect(page.locator('#conversationGenerations .conversation-request')).toHaveCount(2)
		await page.locator('#conversationGenerations .conversation-entry .conversation-requests').nth(1).click()
		await expect(page.locator('#conversationGenerations .conversation-entry').nth(1)).toContainText('instruction 2')
		// 本代最后一轮才展示最终回复；后续生成仍不可见。
		await page.locator('#conversationReplaySlider').fill('4')
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(4)
		await expect(page.locator('#conversationGenerations .conversation-request')).toHaveCount(4)
		await expect(page.locator('#conversationGenerations .conversation-entry-meta .badge')).toHaveCount(4)
		await expect(page.locator('#conversationGenerations .conversation-entry').last().locator('.message-view').first()).toContainText('round 4')
		// 回放到最后一轮显示两条生成
		await page.locator('#conversationReplaySlider').fill('5')
		await expect(page.locator('#conversationGenerations .conversation-entry')).toHaveCount(5)
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
		await expect(page.locator('#conversationGenerations')).toContainText('reply 1')
		await expect(page.locator('#conversationGenerations')).not.toContainText('reply 2')
		await page.locator('#conversationReplaySlider').fill('2')
		await page.locator('#subagentMessageInput').fill('new instruction')
		await page.locator('#subagentMessageForm button').click()
		await expect(page.locator('#subagentTranscript')).toContainText('new instruction')
	})
})
