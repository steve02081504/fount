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
		prompt_struct: { chat_log: [] },
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
		args.prompt_struct.chat_log.map(entry => entry.name),
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

/**
 * 记录并标记失败的处理器。
 * @param {string} label 记录标签
 * @param {string[]} order 顺序数组
 * @returns {Function} handle
 */
function failingHandle(label, order) {
	return async (reply, handlerArgs, call) => { order.push(call ? `${label}:${call.body}` : label); return { regen: true, failed: true } }
}

/**
 * 记录调用体的非失败处理器。
 * @param {string} label 记录标签
 * @param {string[]} order 顺序数组
 * @returns {Function} handle
 */
function recordingOnlyHandle(label, order) {
	return async (reply, handlerArgs, call) => { order.push(`${label}:${call.body}`); return {} }
}

/**
 * 记录调用体并直接停止（不替换 content）的处理器。
 * @param {string} label 记录标签
 * @param {string[]} order 顺序数组
 * @returns {Function} handle
 */
function stoppingHandle(label, order) {
	return async (reply, handlerArgs, call) => { order.push(`${label}:${call.body}`); return { stop: true } }
}

Deno.test('管线：串行调用失败后跳过后续调用并追加跳过提示', async () => {
	const result = makeResult('<fail>bad</fail><next>ok</next>')
	const order = []
	const args = makeArgs()
	const wantRegen = await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'fail', display: emptyDisplay, handle: failingHandle('fail', order) }),
		defineReplyHandler({ tag: 'next', display: emptyDisplay, handle: recordingHandle('next', order) }),
	])
	assertEquals(order, ['fail:bad'], '失败后后续调用不应执行')
	assertEquals(wantRegen, true, '失败应强制建议下一轮生成')
	const skipped = args.prompt_struct.chat_log.find(entry => entry.name === 'chat.skipped-calls')
	assert(skipped, '应追加跳过提示工具日志')
	assertStringIncludes(skipped.content, '<next>ok</next>')
	assertEquals(result.content_for_show.includes('<next>'), false, '跳过调用不应以原始标签泄漏到展示层')
})

Deno.test('管线：并行批次内任一失败仍结算整批并阻断后续', async () => {
	const result = makeResult('<a>1</a><b>2</b><c>3</c>')
	const order = []
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'a', parallel: true, display: emptyDisplay, handle: failingHandle('a', order) }),
		defineReplyHandler({ tag: 'b', parallel: true, display: emptyDisplay, handle: recordingOnlyHandle('b', order) }),
		defineReplyHandler({ tag: 'c', display: emptyDisplay, handle: recordingOnlyHandle('c', order) }),
	])
	assertEquals(order.sort(), ['a:1', 'b:2'], '并行批次应全部结算，后续非并行调用不应执行')
	assert(args.prompt_struct.chat_log.some(entry => entry.name === 'chat.skipped-calls'), '应追加跳过提示')
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
	const report = args.prompt_struct.chat_log.find(entry => entry.name === 'inline-rendered')
	assert(report, '应追加 inline-rendered 回执')
	assertStringIncludes(report.content, '<p>hi</p>')
	assertStringIncludes(report.content, 'RENDERED')
	assert(report.content_for_show, '回执应提供人类展示层')
	assert(report.content_for_show.startsWith('```'), '展示层应围栏化，避免原始标签被当作 HTML 信任渲染')
	assertStringIncludes(report.content_for_show, '<p>hi</p>')
})

Deno.test('管线：stop 且未替换 content 时后续原始标签不泄漏到展示层', async () => {
	const result = makeResult('<stop>first</stop>中<tail>leak</tail>')
	const order = []
	const args = makeArgs()
	const wantRegen = await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'stop', handle: stoppingHandle('stop', order) }),
		defineReplyHandler({ tag: 'tail', handle: recordingOnlyHandle('tail', order) }),
	])
	assertEquals(order, ['stop:first'], 'stop 后后续调用不应执行')
	assertEquals(wantRegen, false)
	assertEquals(result.content_for_show.includes('<stop'), false, '已处理调用不应以原始标签泄漏')
	assertEquals(result.content_for_show.includes('<tail'), false, '停止后未执行的原始标签不应泄漏到展示层')
})

Deno.test('管线：inline 回执每个结果分别按上限截断', async () => {
	const result = makeResult('<p>x</p>')
	const args = makeArgs()
	await runReplyHandlers(result, args, [
		defineReplyHandler({ tag: 'p', evaluate: oversizedEvaluate, display: oversizedDisplay, handle: noopHandle }),
	])
	const report = args.prompt_struct.chat_log.find(entry => entry.name === 'inline-rendered')
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
		args.prompt_struct.chat_log.some(entry => entry.name === 'inline-rendered'),
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

Deno.test('预览：只显示占位，求值由管线启动后就地显示结果', async () => {
	const args = makeArgs()
	let evalCount = 0
	/**
	 * 求值调用体。
	 * @param {object} call 调用
	 * @returns {Promise<string>} 结果
	 */
	async function evaluateInline(call) {
		evalCount++
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
	assertEquals(evalCount, 0, '预览不应启动求值（避免前序失败时后续调用抢先执行）')

	await runReplyHandlers({ content: '<inline-x>hi</inline-x>尾<inline-x>yo', extension: {} }, args, [handler])
	assertEquals(evalCount, 1, '求值应由管线在调用执行时启动')

	const settled = { content: '<inline-x>hi</inline-x>尾<inline-x>yo', extension: args.extension }
	updater(args, settled)
	assertStringIncludes(settled.content_for_show, 'R:hi')
	assertStringIncludes(settled.content_for_show, '[[pending]]')
})

Deno.test('tool summaries retain per-call status and targets in parallel batches', async () => {
	const args = makeArgs()
	const result = makeResult('<view-file>ok.txt</view-file><view-file>missing.txt</view-file>')
	const snapshots = []
	/**
	 * 保存实际发送时的快照。
	 * @param {object} entry 日志条目。
	 * @returns {number} 条目数。
	 */
	args.AddLongTimeLog = entry => snapshots.push(JSON.parse(JSON.stringify(entry)))
	const handler = defineReplyHandler({
		tag: 'view-file', parallel: true, display: emptyDisplay,
		/**
		 * 模拟逐文件结果。
		 * @param {object} reply 回复对象。
		 * @param {object} context 请求上下文。
		 * @param {object} call 工具调用。
		 * @returns {Promise<object>} 结果。
		 */
		handle: async (reply, context, call) => {
			context.AddLongTimeLog({ role: 'tool', content: call.inner, extension: { executionTarget: { machine: '0', workdir: '/tmp' } } })
			return { regen: true, failed: call.inner === 'missing.txt' }
		},
	})
	await runReplyHandlers(result, args, [handler])
	assertEquals(snapshots.map(entry => entry.extension.toolCall), [
		{ tag: 'view-file', summary: 'ok.txt', state: 'succeeded' },
		{ tag: 'view-file', summary: 'missing.txt', state: 'failed' },
	])
	assertEquals(snapshots[0].extension.executionTarget, { machine: '0', workdir: '/tmp' })
})

Deno.test('sequential tool summaries identify edited files without replacement contents', async () => {
	const args = makeArgs()
	const result = makeResult('<replace-file><file path="src/a.mjs"><replacement><search>SECRET</search><replace>other</replace></replacement></file><file path="src/b.mjs"></file></replace-file>')
	const handler = defineReplyHandler({ tag: 'replace-file', display: emptyDisplay, /**
	 * 模拟失败的文件编辑。
	 * @param {object} reply 回复对象。
	 * @param {object} context 请求上下文。
	 * @returns {Promise<object>} 结果。
	 */
		handle: async (reply, context) => {
			context.AddLongTimeLog({ role: 'tool', content: 'not found' })
			return { regen: true, failed: true }
		} })
	await runReplyHandlers(result, args, [handler])
	assertEquals(result.logContextBefore.find(entry => entry.role === 'tool').extension.toolCall,
		{ tag: 'replace-file', summary: 'src/a.mjs, src/b.mjs', state: 'failed' })
})
