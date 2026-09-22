/* global Deno */
/**
 * sub-agent 纯状态逻辑测试：插件集解析、层级轮次传播、限额判定与运行注册表。
 */
import { assertEquals, assertFalse, assert } from 'jsr:@std/assert'

import { notificationQueueKey, pushPendingNotification, resetAsyncTaskState, takePendingNotifications } from '../../../async-task/registry.mjs'
import { parseBooleanAttr, parseDurationMs, parseRoundLimit, terminateSubAgentRun } from '../../runtime.mjs'
import {
	countActiveRunsForAgent,
	countActiveRunsInBatch,
	createRun,
	DEFAULT_SUBAGENT_PLUGINS,
	parsePluginListAttr,
	propagateRoundsToAncestors,
	resetSubAgentState,
	resolvePluginList,
} from '../../state.mjs'

Deno.test('resolvePluginList uses the default set when nothing is declared', () => {
	assertEquals(resolvePluginList(undefined), DEFAULT_SUBAGENT_PLUGINS)
	assertEquals(resolvePluginList([]), DEFAULT_SUBAGENT_PLUGINS)
	assert(resolvePluginList(undefined).includes('sub-agent'))
})

Deno.test('resolvePluginList lets an explicit list fully replace the default', () => {
	const resolved = resolvePluginList(['file-operations'])
	assertEquals(resolved, ['file-operations', 'sub-agent', 'async-task'])
	assertFalse(resolved.includes('code-execution'))
	assertFalse(resolved.includes('context-compress'))
})

Deno.test('resolvePluginList forces sub-agent/async-task and never allows fount_chat', () => {
	assertEquals(resolvePluginList(['code-execution', 'fount_chat']), ['code-execution', 'sub-agent', 'async-task'])
	assertEquals(resolvePluginList(['sub-agent']), ['sub-agent', 'async-task'])
	assertEquals(resolvePluginList(['code-execution', 'sub-agent', 'file-operations']), ['code-execution', 'sub-agent', 'file-operations', 'async-task'])
})

Deno.test('resolvePluginList dedupes and parses comma strings', () => {
	assertEquals(parsePluginListAttr('a, b ,a'), ['a', 'b', 'a'])
	assertEquals(resolvePluginList('a,b,a').filter(name => name === 'a').length, 1)
	assertEquals(resolvePluginList(['file-operations', 'file-operations']), ['file-operations', 'sub-agent', 'async-task'])
})

Deno.test('propagateRoundsToAncestors increments the run and every ancestor', () => {
	resetSubAgentState()
	const grandparent = { runId: 'gp', parentRunId: null, rounds: 0 }
	const parent = { runId: 'p', parentRunId: 'gp', rounds: 0 }
	const child = { runId: 'c', parentRunId: 'p', rounds: 0 }
	/**
	 * 查询运行。
	 * @param {string} runId 运行 id
	 * @returns {object | undefined} 运行
	 */
	const lookup = runId => ({ gp: grandparent, p: parent, c: child }[runId])

	assertEquals(propagateRoundsToAncestors(child, lookup), 3)
	assertEquals(child.rounds, 1)
	assertEquals(parent.rounds, 1)
	assertEquals(grandparent.rounds, 1)

	propagateRoundsToAncestors(child, lookup)
	assertEquals(child.rounds, 2)
	assertEquals(parent.rounds, 2)
	assertEquals(grandparent.rounds, 2)
})

Deno.test('propagateRoundsToAncestors stops at the root and tolerates cycles', () => {
	resetSubAgentState()
	const root = { runId: 'r', parentRunId: null, rounds: 0 }
	propagateRoundsToAncestors(root, () => root)
	assertEquals(root.rounds, 1)

	const a = { runId: 'a', parentRunId: 'b', rounds: 0 }
	const b = { runId: 'b', parentRunId: 'a', rounds: 0 }
	/**
	 * 查询运行。
	 * @param {string} runId 运行 id
	 * @returns {object | undefined} 运行
	 */
	const lookup = runId => runId === 'a' ? a : b
	propagateRoundsToAncestors(a, lookup)
	assertEquals(a.rounds, 1)
	assertEquals(b.rounds, 1)
})

Deno.test('isRunOverLimit reports local round and time budgets', async () => {
	const { isRunOverLimit, isRunRoundExceeded, isRunTimeExceeded } = await import('../../state.mjs')
	const run = { runId: 'x', parentRunId: null, rounds: 2, roundLimit: 3, deadline: 1000 }
	/**
	 * 无祖先查询。
	 * @returns {undefined} undefined
	 */
	const lookup = () => undefined
	assertFalse(isRunRoundExceeded(run))
	assertFalse(isRunOverLimit(run, lookup, 500))
	run.rounds = 3
	assert(isRunRoundExceeded(run))
	assert(isRunOverLimit(run, lookup, 500))
	run.rounds = 0
	assert(isRunTimeExceeded(run, 1000))
	assert(isRunOverLimit(run, lookup, 1000))
})

Deno.test('isRunOverLimit propagates an ancestor breach to the current run', async () => {
	const { isRunOverLimit } = await import('../../state.mjs')
	const ancestor = { runId: 'a', parentRunId: null, rounds: 9, roundLimit: 3, deadline: 10_000 }
	const child = { runId: 'c', parentRunId: 'a', rounds: 0, roundLimit: 99, deadline: 10_000 }
	/**
	 * 查询祖先运行。
	 * @param {string} runId 运行 id
	 * @returns {object | undefined} 运行
	 */
	const lookup = runId => runId === 'a' ? ancestor : undefined
	assert(isRunOverLimit(child, lookup, 500))
})

Deno.test('notification queues are scoped per root agent or per parent run', () => {
	resetAsyncTaskState()
	const rootTarget = { username: 'u', charId: 'c', parentRunId: null }
	const runTarget = { username: 'u', charId: 'c', parentRunId: 'p' }
	assertEquals(notificationQueueKey(rootTarget), 'root|u|c')
	assertEquals(notificationQueueKey(runTarget), 'run|p')

	pushPendingNotification(rootTarget, { content: 'root-note' })
	pushPendingNotification(runTarget, { content: 'run-note' })
	assertEquals(takePendingNotifications(rootTarget).map(entry => entry.content), ['root-note'])
	assertEquals(takePendingNotifications(runTarget).map(entry => entry.content), ['run-note'])
	assertEquals(takePendingNotifications(rootTarget), [])
})

Deno.test('run registry counts active runs per agent and per batch', () => {
	resetSubAgentState()
	createRun({ runId: 'a', username: 'u', charId: 'c', batchId: 'b1', state: 'running' })
	createRun({ runId: 'b', username: 'u', charId: 'c', batchId: 'b1', state: 'summarizing' })
	createRun({ runId: 'c', username: 'u', charId: 'c', batchId: 'b2', state: 'done' })
	assertEquals(countActiveRunsForAgent('u', 'c'), 2)
	assertEquals(countActiveRunsInBatch('b1'), 2)
	assertEquals(countActiveRunsInBatch('b2'), 0)
})

Deno.test('terminateSubAgentRun sets the flag and aborts the controller', () => {
	resetSubAgentState()
	const run = { runId: 'run-1', backgroundId: 'run-1', controller: new AbortController() }
	createRun(run)
	const outcome = terminateSubAgentRun('run-1')
	assertEquals(outcome.ok, true)
	assertEquals(run.terminateRequested, true)
	assertEquals(run.controller.signal.aborted, true)
	assertEquals(terminateSubAgentRun('missing').ok, false)
})

Deno.test('duration, round-limit and boolean attribute parsers accept tool syntax', () => {
	assertEquals(parseDurationMs('90s'), 90_000)
	assertEquals(parseDurationMs('5m'), 300_000)
	assertEquals(parseDurationMs('1.5h'), 5_400_000)
	assertEquals(parseDurationMs('2d'), 172_800_000)
	assertEquals(parseDurationMs('250ms'), 250)
	assertEquals(parseDurationMs('30'), 30_000)
	assertEquals(parseDurationMs('nonsense'), null)
	assertEquals(parseDurationMs(null), null)

	assertEquals(parseRoundLimit('8'), 8)
	assertEquals(parseRoundLimit(0), null)
	assertEquals(parseRoundLimit('x'), null)
	assertEquals(parseRoundLimit(undefined), null)

	assertEquals(parseBooleanAttr('true'), true)
	assertEquals(parseBooleanAttr(true), true)
	assertEquals(parseBooleanAttr('false'), false)
	assertEquals(parseBooleanAttr(undefined), false)
})
