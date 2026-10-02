/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'

Deno.test({ name: 'first run-js gets a valid role API key and concurrent preparation creates one key', sanitizeOps: false, sanitizeResources: false }, async () => {
	await bootHeadlessDataRoot()
	const { register, verifyApiKey } = await import('../../../../../../server/auth/index.mjs')
	const { config } = await import('../../../../../../server/server.mjs')
	const { default: plugin } = await import('../../../fount-api/main.mjs')
	const { getCodeExecutionReplyHandlers } = await import('../../handler.mjs')
	const { runReplyHandlers } = await import('../../../../shells/chat/src/reply/handlerPipeline.mjs')
	const username = `api-context-${crypto.randomUUID()}`
	await register(username, 'test-password')
	const logs = []
	const args = { username, char_id: 'test-char', Charname: 'Test', chat_log: [], plugins: { 'fount-api': plugin }, chat_scoped_char_memory: {}, supported_functions: {},
		/**
		 * 收集执行日志。
		 * @param {object} entry Tool log.
		 * @returns {number} Log count.
		 */
		AddLongTimeLog: entry => logs.push(entry),
	}
	// Do not call BeforeReply: context acquisition itself must make first-round execution safe.
	await runReplyHandlers({ content: '<run-js>typeof fountApiKey === "string" && fountApiKey.length > 0</run-js>' }, args, getCodeExecutionReplyHandlers())
	assert(logs.some(entry => entry.name === 'code-execution.run-js' && entry.content.includes('true')))
	const contexts = await Promise.all(Array.from({ length: 5 }, () => plugin.interfaces.code_execution.GetJSCodeContext({ ...args, char_id: 'another-char' })))
	assert(contexts.every(context => context.fountApiKey === contexts[0].fountApiKey))
	assertEquals((await verifyApiKey(contexts[0].fountApiKey)).username, username)
	assertEquals(Object.values(config.data.apiKeys).filter(key => key.username === username).length, 2)
})
