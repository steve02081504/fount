/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildEnv, normalizeEntries, normalizeHooks } from '../../src/hooks_config.mjs'

Deno.test('normalizeEntries accepts strings and objects with a command', () => {
	assertEquals(normalizeEntries('fount reboot'), [{ command: 'fount reboot' }])
	assertEquals(
		normalizeEntries([{ command: 'a', detached: true }, 'b', { detached: true }, null]),
		[{ command: 'a', detached: true }, { command: 'b' }],
	)
	assertEquals(normalizeEntries(undefined), [])
})

Deno.test('normalizeHooks only keeps the three lifecycle events', () => {
	const hooks = normalizeHooks({
		hooks: {
			agentStart: 'fount test --watch',
			agentFinish: ['deno run hook.mjs'],
			agentsIdle: { command: 'fount reboot', detached: true },
			ignored: ['x'],
		},
	})
	assertEquals(hooks.agentStart, [{ command: 'fount test --watch' }])
	assertEquals(hooks.agentFinish, [{ command: 'deno run hook.mjs' }])
	assertEquals(hooks.agentsIdle, [{ command: 'fount reboot', detached: true }])
	assertEquals(normalizeHooks({}), { agentStart: [], agentFinish: [], agentsIdle: [] })
})

Deno.test('buildEnv maps every event field to FOUNT_CODE_*', () => {
	const env = buildEnv({
		event: 'agent-finish',
		kind: 'code',
		username: 'u',
		sessionId: 's1',
		conversationId: 'code-s1',
		workspaceId: 'w1',
		path: 'C:/repo',
		machine: '0',
		char: 'buddy',
		generationId: 'g1',
		runId: 'r1',
		success: '1',
		error: '',
		attempt: 2,
	})
	assertEquals(env.FOUNT_CODE_EVENT, 'agent-finish')
	assertEquals(env.FOUNT_CODE_CONVERSATION_ID, 'code-s1')
	assertEquals(env.FOUNT_CODE_WORKSPACE_PATH, 'C:/repo')
	assertEquals(env.FOUNT_CODE_SUCCESS, '1')
	assertEquals(env.FOUNT_CODE_ATTEMPT, '2')
	// 缺失字段降级为空串 / 默认值
	const sparse = buildEnv({})
	assertEquals(sparse.FOUNT_CODE_MACHINE, '0')
	assertEquals(sparse.FOUNT_CODE_ATTEMPT, '0')
	assertEquals(sparse.FOUNT_CODE_CHAR, '')
})
