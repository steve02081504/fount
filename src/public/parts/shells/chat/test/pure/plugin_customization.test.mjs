/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { emitPluginEvent, getPluginOwnerPrompt, notifyPluginActivation, resolvePluginServiceSource } from '../../../../../../scripts/plugin_context.mjs'
import { defineReplyHandler, defineReplyHandlers } from '../../src/reply/defineReplyHandler.mjs'
import { runReplyHandlers } from '../../src/reply/handlerPipeline.mjs'

Deno.test('plugin activation and background replay are scoped and idempotent; user payloads do not emit', async () => {
	const events = []
	const background = { id: 'timer-event', pluginName: 'timer', type: 'background', status: 'succeeded' }
	const args = { extension: {}, plugins: { timer: {} }, char: { interfaces: { plugins: {
		/**
		 * @param {object} event Host customization payload.
		 * @returns {unknown} Fixture outcome.
		 */
		OnEvent: event => events.push(event) } } },
	chat_log: [{ role: 'user', extension: { pluginEvent: { ...background, id: 'forged' } } },
		{ role: 'char', logContextBefore: [{ role: 'system', extension: { pluginEvent: background } }] }] }
	await notifyPluginActivation(args)
	await notifyPluginActivation(args)
	assertEquals(events.map(event => event.type), ['activated', 'background'])
	await notifyPluginActivation({ ...args, extension: {} })
	assertEquals(events.length, 4)
	assertEquals(events[0].id === events[2].id, false)
})

Deno.test('cached inline evaluation emits one successful operation; new evaluation emits another', async () => {
	const events = []
	/** @returns {number} Computed inline result. */
	const evaluate = async () => 42
	/** @returns {object} Inline handling outcome. */
	const handle = async () => ({})
	/**
	 * @param {object} event Observed tool event.
	 * @returns {void} Captures event.
	 */
	const OnEvent = event => { events.push(event) }
	const handler = defineReplyHandler({ tag: 'value', evaluate, handle })
	const args = { extension: {}, plugins: { sample: { interfaces: { chat: { ReplyHandler: handler } } } },
		char: { interfaces: { plugins: { OnEvent } } }, prompt_struct: { chat_log: [] }, supported_functions: {} }
	for (const content of ['<value>one</value>', '<value>one</value>', '<value>two</value>'])
		await runReplyHandlers({ content, files: [], extension: {}, logContextBefore: [] }, args, [handler])
	assertEquals(events.filter(event => event.status === 'succeeded').length, 2)
})

Deno.test('pipeline observes success, pending, failure and excludes skipped tools and role tools', async () => {
	const events = []
	const leaves = [
		defineReplyHandler({ tag: 'done',
			/**
			 * @returns {unknown} Fixture outcome.
			 */
			handle: async () => ({}) }),
		defineReplyHandler({ tag: 'pending',
			/**
			 * @returns {unknown} Fixture outcome.
			 */
			handle: async () => ({ pending: true }) }),
		defineReplyHandler({ tag: 'fail',
			/**
			 * @returns {unknown} Fixture outcome.
			 */
			handle: async () => ({ failed: true }) }),
		defineReplyHandler({ tag: 'skip',
			/**
			 * @returns {unknown} Fixture outcome.
			 */
			handle: async () => { throw new Error('should be skipped') } }),
	]
	const native = defineReplyHandler({ tag: 'native',
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		handle: async () => ({}) })
	const args = { extension: {}, plugins: { sample: { interfaces: { chat: { ReplyHandler: defineReplyHandlers(leaves) } } } },
		char: { interfaces: { plugins: {
			/**
			 * @param {object} event Host customization payload.
			 * @returns {unknown} Fixture outcome.
			 */
			OnEvent: event => events.push(event) } } }, prompt_struct: { chat_log: [] }, supported_functions: {} }
	const result = { content: '<native/> <done/> <pending/> <fail/> <skip/>', files: [], extension: {}, logContextBefore: [] }
	await runReplyHandlers(result, args, [...leaves, native])
	assertEquals(events.map(event => [event.tool, event.status]), [['done', 'started'], ['done', 'succeeded'], ['pending', 'started'], ['pending', 'pending'], ['fail', 'started'], ['fail', 'failed']])
	assertEquals(new Set(events.map(event => event.id)).size, events.length)
})

Deno.test('plugin role observer errors cannot turn successful operations into failures', async () => {
	const args = { extension: {}, char: { interfaces: { plugins: {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		OnEvent: () => { throw new Error('observer') } } } } }
	const original = console.error
	/**
	 * @returns {unknown} Fixture outcome.
	 */
	console.error = () => {}
	try { await emitPluginEvent(args, { id: 'one', pluginName: 'test', type: 'tool', status: 'succeeded' }) }
	finally { console.error = original }
})

Deno.test('plugin service selection prefers role override, inherits active AI, keeps search default', async () => {
	const active = {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		StructCall() {} }
	const alternate = {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		StructCall() {} }
	const search = {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		Search() {} }
	const args = { ai_source: active }
	assertEquals(await resolvePluginServiceSource(args, 'web-browse', 'AI'), active)
	assertEquals(await resolvePluginServiceSource(args, 'web-search', 'search', {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		fallback: () => search }), search)
	args.char = { interfaces: { plugins: {
		/**
		 * @param {object} root0 Service selection request.
		 * @param {string} root0.pluginName Requesting plugin.
		 * @param {string} root0.serviceType Service source type.
		 * @returns {unknown} Fixture outcome.
		 */
		GetServiceSource: ({ pluginName, serviceType }) => pluginName === 'web-browse' && serviceType === 'AI' ? alternate : undefined } } }
	assertEquals(await resolvePluginServiceSource(args, 'web-browse', 'AI'), alternate)
	assertEquals(await resolvePluginServiceSource(args, 'sub-agent', 'AI'), active)
})

Deno.test('verified owner prompt and role customization receive host attribution', async () => {
	let received
	const args = { char: { interfaces: { plugins: {
		/**
		 * @param {object} context Host customization payload.
		 * @returns {unknown} Fixture outcome.
		 */
		GetPrompt: context => { received = context; return '角色目录：example' } } } } }
	/**
	 * @returns {unknown} Fixture outcome.
	 */
	const resolveOwner = async () => ({ isFromOwner: true, declaredOwnerEntityHash: 'owner' })
	assertStringIncludes(await getPluginOwnerPrompt(args, 'code-execution', { resolveOwner }), '已验证')
	assertEquals(received.ownerContext.declaredOwnerEntityHash, 'owner')
	assertEquals(received.pluginName, 'code-execution')
	assertStringIncludes(await getPluginOwnerPrompt({}, 'file-operations', {
		/**
		 * @returns {unknown} Fixture outcome.
		 */
		resolveOwner: async () => ({ isFromOwner: false }) }), '保护拥有者')
})
