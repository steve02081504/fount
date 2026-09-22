/* global Deno */
/**
 * code shell 条目扩展白名单测试：前端渲染所需字段保留，内部结构剔除。
 */
import { assertEquals } from 'jsr:@std/assert'

import { pickEntryExtension } from '../../src/entry_extension.mjs'

Deno.test('pickEntryExtension keeps frontend-rendering fields and drops the rest', () => {
	const picked = pickEntryExtension({
		subAgent: { runId: 'r' },
		subAgentCheck: { runId: 'r' },
		asyncTask: { id: 't', kind: 'js' },
		asyncList: { tasks: [] },
		asyncAwait: { settled: [] },
		error: true,
		loadedContextHashes: ['abc', 'def'],
		feedback: { type: 'up' },
		internal: { secret: 1 },
	})
	assertEquals(picked, {
		subAgent: { runId: 'r' },
		subAgentCheck: { runId: 'r' },
		asyncTask: { id: 't', kind: 'js' },
		asyncList: { tasks: [] },
		asyncAwait: { settled: [] },
		error: true,
		loadedContextHashes: ['abc', 'def'],
	})
	assertEquals(pickEntryExtension(null), {})
	assertEquals(pickEntryExtension('nope'), {})
})
