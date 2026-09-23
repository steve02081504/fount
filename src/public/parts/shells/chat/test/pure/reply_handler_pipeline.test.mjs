/**
 * ReplyHandler 核心测试：标签解析、defineReplyHandler level 折算、管线 level/顺序/容器消耗、
 * evaluate 缓存与展示派生、stop 短路、原始生成入日志，以及预览 SSOT。
 */
/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { defineReplyHandler, defineReplyHandlers } from '../../src/reply/defineReplyHandler.mjs'
import { runReplyHandlers } from '../../src/reply/handlerPipeline.mjs'
import { defineReplyPreviews } from '../../src/streaming/replyPreviews.mjs'
import { collectTagCalls, findOpenTag, parseAttrs, parseBody, parseChildren, parseParams } from '../../src/tags/index.mjs'

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
 * 构造回复对象。
 * @param {string} content 原始生成
 * @returns {object} result
 */
function makeResult(content) {
	return { content, logContextBefore: [], files: [], extension: {} }
}

/**
 * 空展示。
 * @returns {string} 空串
 */
function emptyDisplay() {
	return ''
}

/**
 * 固定展示「RENDERED」。
 * @returns {string} 展示文本
 */
function renderedDisplay() {
	return 'RENDERED'
}

/**
 * 生成超长展示文本。
 * @returns {string} 展示文本
 */
function oversizedDisplay() {
	return 'A'.repeat(10_000)
}

/**
 * 原样返回调用原文（用于测试无可见变化的 inline）。
 * @param {object} call 调用
 * @returns {string} 调用原文
 */
function identityRawDisplay(call) {
	return call.raw
}

/**
 * 固定求值结果（inline 类）。
 * @returns {Promise<string>} 结果
 */
async function renderedEvaluate() {
	return 'RENDERED'
}

/**
 * 超长求值结果（inline 类）。
 * @returns {Promise<string>} 结果
 */
async function oversizedEvaluate() {
	return 'A'.repeat(10_000)
}

/**
 * 生成记录调用体的处理器。
 * @param {string} label 记录标签
 * @param {string[]} order 顺序数组
 * @param {boolean} [regen] 是否建议重新生成
 * @returns {Function} handle
 */
function recordingHandle(label, order, regen = true) {
	return async (reply, args, call) => {
		order.push(`${label}:${call ? call.body : 'content'}`)
		return { regen }
	}
}

/**
 * 直接返回封禁内容并停止的处理器。
 * @returns {Promise<object>} 结果
 */
async function blockHandle() {
	return { content: 'BLOCKED', stop: true }
}

/**
 * 不重生成的处理器。
 * @returns {Promise<object>} 结果
 */
async function noopHandle() {
	return { regen: false }
}

/**
 * 生成记录并发峰值并追加日志的处理器。
 * @param {{ active: number, max: number }} probe 并发探针
 * @returns {Function} handle
 */
function makeConcurrencyProbe(probe) {
	return async (reply, args, call) => {
		probe.active++
		probe.max = Math.max(probe.max, probe.active)
		await new Promise(resolve => setTimeout(resolve, 10))
		probe.active--
		args.AddLongTimeLog({ name: `p-${call.body}`, role: 'tool', content: call.body })
		return {}
	}
}

Deno.test('标签解析：完整/自闭合/属性/大小写/内层', () => {
	const calls = collectTagCalls('前<a x="1" y=\'2\' z>体</a> 中<b/> 后<C>c</C>', 'a')
	assertEquals(calls.length, 1)
	assertEquals(calls[0].inner, '体')
	assertEquals(parseAttrs('x="1" y=\'2\' z').z, true)
	assertEquals(collectTagCalls('<b/>', 'b')[0].selfClosing, true)
	assertEquals(collectTagCalls('<C>c</C>', 'c').length, 1)
	const children = parseChildren('<x a="1">i</x><y/>')
	assertEquals(children.map(child => child.tag), ['x', 'y'])
	assertEquals(children[0].body, 'i')
	assertEquals(parseBody('lines', ' a \n\n b ', {}), ['a', 'b'])
	assertEquals(parseParams({ force: 'boolean', n: 'number', s: 'string' }, { force: 'true', n: '3' }), { force: true, n: 3, s: '' })
})

Deno.test('findOpenTag：仅返回未闭合尾标签', () => {
	assertEquals(findOpenTag('<a>x</a>', 'a'), null)
	const open = findOpenTag('前<a x="1">未完', 'a')
	assertEquals(open.open, true)
	assertEquals(open.inner, '未完')
})

Deno.test('defineReplyHandler：phase 与 level 相加', () => {
	assertEquals(defineReplyHandler({ tag: 't', handle: noopHandle }).level, 0)
	assertEquals(defineReplyHandler({ tag: 't', phase: 'before', handle: noopHandle }).level, -100)
	assertEquals(defineReplyHandler({ tag: 't', phase: 'after', level: 5, handle: noopHandle }).level, 105)
	assertEquals(defineReplyHandler({ tag: 't', phase: 'before', level: 30, handle: noopHandle }).level, -70)
})

Deno.test('管线：level 分组决定执行先后（跨标签文本顺序不越级）', async () => {
	const result = makeResult('<a>1</a><b>2</b>')
	const order = []
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'a', display: emptyDisplay, handle: recordingHandle('a', order) }),
		defineReplyHandler({ tag: 'b', phase: 'before', display: emptyDisplay, handle: recordingHandle('b', order) }),
	])
	assertEquals(order, ['b:2', 'a:1'])
})

Deno.test('defineReplyHandlers：组合节点被展开，与直接传数组等价', async () => {
	const result = makeResult('<a>1</a><b>2</b>')
	const order = []
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandlers([
			defineReplyHandler({ tag: 'a', display: emptyDisplay, handle: recordingHandle('a', order) }),
			defineReplyHandler({ tag: 'b', display: emptyDisplay, handle: recordingHandle('b', order) }),
		]),
	])
	assertEquals(order, ['a:1', 'b:2'])
})

Deno.test('管线：同 level 按生成文本顺序融合执行', async () => {
	const result = makeResult('<a>1</a>中<b>2</b>尾<a>3</a>')
	const order = []
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'a', display: emptyDisplay, handle: recordingHandle('a', order) }),
		defineReplyHandler({ tag: 'b', display: emptyDisplay, handle: recordingHandle('b', order) }),
	])
	assertEquals(order, ['a:1', 'b:2', 'a:3'])
})

Deno.test('管线：容器标签整段消耗，内层标签不单独执行', async () => {
	const result = makeResult('<a>外层<b>内层</b></a>')
	const order = []
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'a', display: emptyDisplay, handle: recordingHandle('a', order) }),
		defineReplyHandler({ tag: 'b', display: emptyDisplay, handle: recordingHandle('b', order) }),
	])
	assertEquals(order, ['a:外层<b>内层</b>'])
})

Deno.test('管线：声明 parallel 的同一工具多次调用并发执行（与参数无关）', async () => {
	const result = makeResult('<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p>')
	const args = makeArgs()
	const probe = { active: 0, max: 0 }
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', display: emptyDisplay, parallel: true, handle: makeConcurrencyProbe(probe) }),
	])
	assertEquals(probe.max, 5, '本机一次读 5 个文件的同类调用应全部并发')
	assertEquals(
		args.prompt_struct.char_prompt.additional_chat_log.map(entry => entry.name),
		['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
		'日志应按生成文本顺序回放',
	)
})

Deno.test('管线：未声明 parallel 的调用保持串行', async () => {
	const result = makeResult('<p>1</p><p>2</p>')
	const args = makeArgs()
	const probe = { active: 0, max: 0 }
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', display: emptyDisplay, handle: makeConcurrencyProbe(probe) }),
	])
	assertEquals(probe.max, 1, '未声明并行必须串行')
})

Deno.test('管线：互相声明兼容的不同工具可并发执行', async () => {
	const result = makeResult('<a>1</a><b>2</b>')
	const args = makeArgs()
	const probe = { active: 0, max: 0 }
	await runReplyHandlers(result, args, [
		defineReplyHandler({ name: 'a', tag: 'a', display: emptyDisplay, parallel: ['b'], handle: makeConcurrencyProbe(probe) }),
		defineReplyHandler({ name: 'b', tag: 'b', display: emptyDisplay, parallel: ['a'], handle: makeConcurrencyProbe(probe) }),
	])
	assertEquals(probe.max, 2, '互相兼容的不同工具应并发')
})

Deno.test('管线：三段相邻并行调用只替换正文中的原文，不误替推理前缀', async () => {
	const calls = [
		'<glob path="docs/design">**/*.md</glob>',
		'<view-file>\ndocs/AGENTS.md\n</view-file>',
		'<grep include="*.mjs" path="src/server">\nsaveShellData\n</grep>',
	]
	const prefix = `<details>引用原始调用：${calls[0]}</details>\n\n`
	const content = `先并行测文件工具。\n\n${calls.join('\n\n')}`
	const result = makeResult(content)
	result.content_for_show = prefix + content
	const seen = []
	/**
	 * 构造固定展示文本。
	 * @param {string} tag 标签名
	 * @returns {Function} 展示函数
	 */
	const displayFor = tag => () => `[${tag}]`
	await runReplyHandlers(result, makeArgs(), ['glob', 'view-file', 'grep'].map(tag =>
		defineReplyHandler({ tag, parallel: true, display: displayFor(tag), handle: recordingHandle(tag, seen, false) })
	))
	assertEquals(seen.map(item => item.split(':')[0]), ['glob', 'view-file', 'grep'])
	assertEquals(result.content_for_show, prefix + '先并行测文件工具。\n\n[glob]\n\n[view-file]\n\n[grep]')
	for (const raw of calls) assertEquals(result.content_for_show.slice(prefix.length).includes(raw), false)
})

Deno.test('管线：三个相邻并行工具调用的最终展示没有任何原始标签', async () => {
	const content = '<glob path="docs/design">**/*.md</glob>\n<view-file>\ndocs/AGENTS.md\n</view-file>\n<grep include="*.mjs" path="src/server">\nsaveShellData\n</grep>'
	const result = makeResult(content)
	result.content_for_show = `<details>推理过程</details>\n${content}`
	await runReplyHandlers(result, makeArgs(), ['glob', 'view-file', 'grep'].map(tag =>
		defineReplyHandler({ tag, parallel: true, display: emptyDisplay, handle: noopHandle })
	))
	for (const tag of ['glob', 'view-file', 'grep'])
		assertEquals(result.content_for_show.includes(`<${tag}`), false)
})

Deno.test('管线：串行重复调用按原文顺序替换，推理前缀不参与匹配', async () => {
	const raw = '<p>same</p>'
	const prefix = `<details>${raw}</details>\n`
	const result = makeResult(`${raw} ${raw}`)
	result.content_for_show = prefix + result.content
	let displayCount = 0
	/** @returns {string} 按调用顺序生成展示文本 */
	const nextDisplay = () => `result-${++displayCount}`
	await runReplyHandlers(result, makeArgs(), [
		defineReplyHandler({ tag: 'p', display: nextDisplay, handle: noopHandle }),
	])
	assertEquals(result.content_for_show, `${prefix}result-1 result-2`)
})

Deno.test('管线：内容型 handler 先于同组标签执行，stop 短路且不 regen', async () => {
	const result = makeResult('<a>1</a>')
	const order = []
	const args = makeArgs()
	const wantRegen = await runReplyHandlers(result, args, [
		defineReplyHandler({ phase: 'before', handle: blockHandle }),
		defineReplyHandler({ tag: 'a', display: emptyDisplay, handle: recordingHandle('a', order) }),
	])
	assertEquals(order, [])
	assertEquals(result.content, 'BLOCKED')
	assertEquals(wantRegen, false)
})

Deno.test('管线：内容型 handler 整条替换 content 时 show 同步重置（防泄漏）', async () => {
	const result = makeResult('泄露内容')
	result.content_for_show = '泄露内容（预览）'
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ phase: 'before', handle: blockHandle }),
	])
	assertEquals(result.content, 'BLOCKED')
	assertEquals(result.content_for_show, 'BLOCKED')
})

Deno.test('管线：evaluate 缓存复用，display 派生 show，regen 插入原始生成', async () => {
	const result = makeResult('思考<inline-x>hi</inline-x>')
	let evalCount = 0
	let seenValue
	/**
	 * 求值调用体。
	 * @param {object} call 调用
	 * @returns {Promise<string>} 结果
	 */
	async function evaluateInline(call) {
		evalCount++
		return `VAL:${call.body.trim()}`
	}
	/**
	 * 展示求值结果。
	 * @param {object} call 调用
	 * @param {object} state 展示状态
	 * @returns {string} 展示文本
	 */
	function displayInline(call, state) {
		return state.value ?? '...'
	}
	/**
	 * 记录 value。
	 * @param {object} reply 回复
	 * @param {object} args 上下文
	 * @param {object} call 调用
	 * @returns {Promise<object>} 结果
	 */
	async function handleInline(reply, args, call) {
		seenValue = call.value
		return { regen: true }
	}
	const args = makeArgs()
	const wantRegen = await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'inline-x', evaluate: evaluateInline, display: displayInline, handle: handleInline }),
	])
	assertEquals(evalCount, 1)
	assertEquals(seenValue, 'VAL:hi')
	assertEquals(wantRegen, true)
	assertEquals(result.content_for_show, '思考VAL:hi')
	const rawEntry = result.logContextBefore.find(entry => entry.role === 'char')
	assertEquals(rawEntry.content, '思考<inline-x>hi</inline-x>')
	assertStringIncludes(rawEntry.content_for_show, 'VAL:hi')
	assertEquals(rawEntry.content_for_show.includes('<inline-x>'), false)
})

Deno.test('管线：声明 evaluate 的 inline 结果自动回执给角色', async () => {
	const result = makeResult('<p>hi</p>')
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', evaluate: renderedEvaluate, display: renderedDisplay, handle: noopHandle }),
	])
	assertEquals(result.content_for_show, 'RENDERED')
	const report = args.prompt_struct.char_prompt.additional_chat_log.find(entry => entry.name === 'inline-rendered')
	assert(report, '应追加 inline-rendered 回执')
	assertStringIncludes(report.content, '<p>hi</p>')
	assertStringIncludes(report.content, 'RENDERED')
})

Deno.test('管线：inline 回执每个结果分别按上限截断', async () => {
	const result = makeResult('<p>x</p>')
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', evaluate: oversizedEvaluate, display: oversizedDisplay, handle: noopHandle }),
	])
	const report = args.prompt_struct.char_prompt.additional_chat_log.find(entry => entry.name === 'inline-rendered')
	assertStringIncludes(report.content, '省略')
	assert(report.content.length < 3000, `单个 inline 结果应被截断，实际 ${report.content.length}`)
})

Deno.test('管线：inline 结果与原文相同则不回执', async () => {
	const result = makeResult('<p>hi</p>')
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', evaluate: renderedEvaluate, display: identityRawDisplay, handle: noopHandle }),
	])
	assertEquals(
		args.prompt_struct.char_prompt.additional_chat_log.some(entry => entry.name === 'inline-rendered'),
		false,
		'无可见变化时不应回执',
	)
})

Deno.test('管线：无 evaluate 的块级调用在终态折叠，且不 regen 时不写日志', async () => {
	const result = makeResult('前<view-file>a.mjs</view-file>后')
	const args = makeArgs()
	const wantRegen = await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'view-file', handle: noopHandle }),
	])
	assertEquals(wantRegen, false)
	assertEquals(result.content_for_show, '前后')
	assertEquals(result.logContextBefore.length, 0)
})

Deno.test('预览：未闭合标签显示占位，evaluate 结算后就地显示结果', async () => {
	const args = makeArgs()
	/**
	 * 求值调用体。
	 * @param {object} call 调用
	 * @returns {Promise<string>} 结果
	 */
	async function evaluateInline(call) {
		return `R:${call.body}`
	}
	/**
	 * 展示求值结果。
	 * @param {object} call 调用
	 * @param {object} state 展示状态
	 * @returns {string} 展示文本
	 */
	function displayInline(call, state) {
		return state.value ?? '[[pending]]'
	}
	const handler = defineReplyHandler({ tag: 'inline-x', evaluate: evaluateInline, display: displayInline, handle: noopHandle })
	const updater = defineReplyPreviews([handler])()

	const streaming = { content: '<inline-x>hi</inline-x>尾<inline-x>yo', extension: {} }
	updater(args, streaming)
	assertStringIncludes(streaming.content_for_show, '[[pending]]')

	await new Promise(resolve => setTimeout(resolve, 0))
	const settled = { content: '<inline-x>hi</inline-x>尾<inline-x>yo', extension: args.extension }
	updater(args, settled)
	assertStringIncludes(settled.content_for_show, 'R:hi')
	assertStringIncludes(settled.content_for_show, '[[pending]]')
})
