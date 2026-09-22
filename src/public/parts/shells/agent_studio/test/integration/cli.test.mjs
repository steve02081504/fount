/* global Deno */
/**
 * Agent Studio CLI 纯行为测试：参数解析、文本渲染与错误路径（不触碰用户数据）。
 */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { parseArgs, renderConversationText, renderConversationsText, runStudioCli } from '../../src/cli.mjs'

Deno.test('parseArgs separates flags, values and positionals', () => {
	const parsed = parseArgs(['--json', '--char', 'demo', '--limit=5', 'key'])
	assertEquals(parsed._, ['key'])
	assertEquals(parsed.flags.json, true)
	assertEquals(parsed.flags.char, 'demo')
	assertEquals(parsed.flags.limit, '5')
})

Deno.test('renderConversationsText lists sessions with counts', () => {
	const text = renderConversationsText([
		{ key: 'code-abc', generationCount: 2, requestCount: 3, charname: 'Demo', finishedAt: 0 },
	])
	assertEquals(text.includes('code-abc'), true)
	assertEquals(text.includes('生成 2 条'), true)
	assertEquals(text.includes('轮次 3'), true)
})

Deno.test('renderConversationText includes system prompt, messages and round index', () => {
	const text = renderConversationText({
		key: 'code-abc',
		generations: [{
			id: 'g1',
			source: 'shells/code',
			charname: 'Demo',
			startedAt: 0,
			response: 'hello',
			requests: [{
				index: 1,
				model: 'demo-model',
				startedAt: 0,
				systemPrompt: 'you are demo',
				messages: [{ role: 'user', name: 'alice', content: 'hi' }],
			}],
		}],
	})
	assertEquals(text.includes('轮次 1'), true)
	assertEquals(text.includes('you are demo'), true)
	assertEquals(text.includes('user alice: hi'), true)
})

Deno.test('runStudioCli returns usage without a subcommand and rejects unknown ones', async () => {
	const usage = await runStudioCli('demo-user', [])
	assertEquals(usage.includes('fount run agent_studio'), true)
	await assertRejects(() => runStudioCli('demo-user', ['nope']), Error)
})
