/**
 * BeforeReply 生成前钩子测试：并发运行、按插件键顺序确定性回放、失败隔离、
 * 条目同时落入 logContextBefore 与 char_prompt.additional_chat_log、无钩子时 no-op。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createLongTimeLogger, runBeforeReplyHooks } from '../../src/reply/handlerPipeline.mjs'

/**
 * 构造最小请求上下文。
 * @returns {object} args
 */
function makeArgs() {
	return {
		Charname: 'Tester',
		CharUid: 'uid:char',
		UserUid: 'uid:user',
		char_id: 'tester',
		locales: [],
		supported_functions: { markdown: true },
		prompt_struct: { char_prompt: { additional_chat_log: [] } },
		extension: {},
	}
}

/**
 * 构造回复结果容器。
 * @returns {object} result
 */
function makeResult() {
	return { content: '', logContextBefore: [], files: [], extension: {} }
}

/**
 * 构造一个实现 BeforeReply 的插件。
 * @param {Function} beforeReply 钩子实现
 * @returns {object} 插件
 */
function makePlugin(beforeReply) {
	return { interfaces: { chat: { BeforeReply: beforeReply } } }
}

Deno.test('BeforeReply：并发完成但按插件键顺序确定性回放', async () => {
	const args = makeArgs()
	const result = makeResult()
	args.AddLongTimeLog = createLongTimeLogger(args, result, args.prompt_struct)
	args.plugins = {
		slow: makePlugin(async ({ AddLongTimeLog }) => {
			await new Promise(resolve => setTimeout(resolve, 20))
			AddLongTimeLog({ name: 'slow', role: 'tool', content: 's' })
		}),
		fast: makePlugin(async ({ AddLongTimeLog }) => {
			AddLongTimeLog({ name: 'fast', role: 'tool', content: 'f' })
		}),
	}
	await runBeforeReplyHooks(args)
	assertEquals(result.logContextBefore.map(entry => entry.name), ['slow', 'fast'])
	assertEquals(
		args.prompt_struct.char_prompt.additional_chat_log.map(entry => entry.name),
		['slow', 'fast'],
	)
})

Deno.test('BeforeReply：各插件并发运行', async () => {
	const args = makeArgs()
	const probe = { active: 0, max: 0 }
	args.AddLongTimeLog = createLongTimeLogger(args, makeResult(), args.prompt_struct)
	/**
	 * 记录并发峰值。
	 * @returns {Promise<void>}
	 */
	const hook = async () => {
		probe.active++
		probe.max = Math.max(probe.max, probe.active)
		await new Promise(resolve => setTimeout(resolve, 10))
		probe.active--
	}
	args.plugins = { a: makePlugin(hook), b: makePlugin(hook) }
	await runBeforeReplyHooks(args)
	assertEquals(probe.max, 2)
})

Deno.test('BeforeReply：单个插件失败被隔离且不影响其他插件', async () => {
	const args = makeArgs()
	const result = makeResult()
	args.AddLongTimeLog = createLongTimeLogger(args, result, args.prompt_struct)
	const originalError = console.error
	let errorCount = 0
	/**
	 *
	 */
	console.error = () => { errorCount++ }
	try {
		args.plugins = {
			bad: makePlugin(async () => { throw new Error('boom') }),
			good: makePlugin(async ({ AddLongTimeLog }) => {
				AddLongTimeLog({ name: 'good', role: 'tool', content: 'ok' })
			}),
		}
		await runBeforeReplyHooks(args)
	}
	finally {
		console.error = originalError
	}
	assertEquals(errorCount, 1)
	assertEquals(result.logContextBefore.map(entry => entry.name), ['good'])
})

Deno.test('BeforeReply：条目同时落入 logContextBefore 与 char_prompt.additional_chat_log，并补 uid/可见性', async () => {
	const args = makeArgs()
	const result = makeResult()
	args.AddLongTimeLog = createLongTimeLogger(args, result, args.prompt_struct)
	args.plugins = {
		reader: makePlugin(async ({ AddLongTimeLog }) => {
			AddLongTimeLog({ name: 'preread', role: 'tool', content: 'body' })
		}),
	}
	await runBeforeReplyHooks(args)
	const entry = result.logContextBefore[0]
	assert(entry)
	assertEquals(args.prompt_struct.char_prompt.additional_chat_log[0], entry)
	assertEquals(entry.uid, 'system')
	assertEquals(entry.charVisibility, ['tester'])
})

Deno.test('BeforeReply：未实现钩子的插件被忽略', async () => {
	const args = makeArgs()
	const result = makeResult()
	args.AddLongTimeLog = createLongTimeLogger(args, result, args.prompt_struct)
	args.plugins = {
		plain: { interfaces: { chat: {} } },
		empty: { interfaces: {} },
		broken: { interfaces: { chat: { BeforeReply: 'not-a-function' } } },
	}
	await runBeforeReplyHooks(args)
	assertEquals(result.logContextBefore.length, 0)
})

Deno.test('BeforeReply：无插件实现钩子时立即返回', async () => {
	const args = makeArgs()
	let called = 0
	/**
	 *
	 */
	args.AddLongTimeLog = () => { called++ }
	args.plugins = {}
	await runBeforeReplyHooks(args)
	assertEquals(called, 0)
})

Deno.test('BeforeReply：缺少 AddLongTimeLog 时不运行钩子', async () => {
	const args = makeArgs()
	let ran = 0
	args.plugins = { p: makePlugin(async () => { ran++ }) }
	await runBeforeReplyHooks(args)
	assertEquals(ran, 0)
})
