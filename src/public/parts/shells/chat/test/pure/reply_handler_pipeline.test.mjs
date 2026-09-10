/**
 * runReplyHandlers 纯测试：content_for_handle 工作副本、跨工具误触发防护、
 * fixpoint 多工具处理、返回语义（是否建议重新生成）与原始生成入日志。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { runReplyHandlers } from '../../src/reply/handlerPipeline.mjs'

/**
 * 构造最小请求上下文。
 * @param {string} content 原始生成
 * @returns {object} args
 */
function makeArgs(content) {
	return {
		Charname: 'Tester',
		CharUid: 'uid:char',
		UserUid: 'uid:user',
		char_id: 'tester',
		content,
		prompt_struct: { char_prompt: { additional_chat_log: [] } },
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

Deno.test('content_for_handle 是独立副本，handler 掩除不改写原始 content', async () => {
	const result = makeResult('前<tool-a>x</tool-a>后')
	const args = makeArgs(result.content)
	const seen = []
	await runReplyHandlers(result, args, [
		async (reply, a) => {
			seen.push(reply.content_for_handle)
			a.MaskHandledCall('<tool-a>x</tool-a>', '')
			return false
		},
	])
	assertEquals(seen[0], '前<tool-a>x</tool-a>后')
	assertEquals(result.content, '前<tool-a>x</tool-a>后')
	assertEquals('content_for_handle' in result, false)
})

Deno.test('工具 A 的参数不会触发工具 B 的调用', async () => {
	const result = makeResult('<run-js>const s = "<set-timer>fake</set-timer>"</run-js>')
	const args = makeArgs(result.content)
	let timerMatched = false
	await runReplyHandlers(result, args, [
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<run-js>[\S\s]*?<\/run-js>/)
			if (!m) return false
			a.MaskHandledCall(m[0], '')
			return false
		},
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<set-timer>[\S\s]*?<\/set-timer>/)
			if (!m) return false
			timerMatched = true
			a.MaskHandledCall(m[0], '')
			return true
		},
	])
	assertEquals(timerMatched, false)
})

Deno.test('fixpoint：一轮内多个同类调用全部处理', async () => {
	const result = makeResult('<t>a</t>中间<t>b</t>')
	const args = makeArgs(result.content)
	const handled = []
	const wantRegen = await runReplyHandlers(result, args, [
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<t>(.*?)<\/t>/)
			if (!m) return false
			handled.push(m[1])
			a.MaskHandledCall(m[0], '')
			return true
		},
	])
	assertEquals(handled, ['a', 'b'])
	assertEquals(wantRegen, true)
})

Deno.test('所有 handler 返回 false 时视为最终结果，不写入原始生成', async () => {
	const result = makeResult('纯追加<inline-js>1+1</inline-js>')
	const args = makeArgs(result.content)
	const wantRegen = await runReplyHandlers(result, args, [
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<inline-js>[\S\s]*?<\/inline-js>/)
			if (!m) return false
			a.AddLongTimeLog({ name: 'code-execution', role: 'tool', content: '结果：2' })
			a.MaskHandledCall(m[0], '')
			return false
		},
	])
	assertEquals(wantRegen, false)
	assertEquals(result.logContextBefore.length, 1)
	assertEquals(result.logContextBefore[0].name, 'code-execution')
	assertEquals(args.prompt_struct.char_prompt.additional_chat_log.length, 1)
})

Deno.test('建议重新生成时原始生成（含思考）插在本轮工具结果之前', async () => {
	const result = makeResult('<tool-a>x</tool-a>')
	result.extension = { reasoning_content: '我需要调用工具' }
	const args = makeArgs(result.content)
	const wantRegen = await runReplyHandlers(result, args, [
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<tool-a>[\S\s]*?<\/tool-a>/)
			if (!m) return false
			a.AddLongTimeLog({ name: 'tool-a', role: 'tool', content: 'done' })
			a.MaskHandledCall(m[0], '')
			return true
		},
	])
	assertEquals(wantRegen, true)
	const logs = result.logContextBefore
	assertEquals(logs.length, 2)
	assertEquals(logs[0].role, 'char')
	assertEquals(logs[0].content, '<tool-a>x</tool-a>')
	assertEquals(logs[0].extension.reasoning_content, '我需要调用工具')
	assertEquals(logs[1].role, 'tool')
	assertEquals(args.prompt_struct.char_prompt.additional_chat_log.length, 2)
	assertEquals(args.prompt_struct.char_prompt.additional_chat_log[0].content, '<tool-a>x</tool-a>')
})

Deno.test('原始生成的人类展示层同步剔除已处理工具调用段', async () => {
	const result = makeResult('思考后调用 <tool-a>x</tool-a>，再看 <tool-b>y</tool-b>。')
	result.content_for_show = '<details>思考</details>\n\n' + result.content
	const args = makeArgs(result.content)
	await runReplyHandlers(result, args, [
		async (reply, a) => {
			for (const name of ['a', 'b']) {
				const m = reply.content_for_handle.match(new RegExp(`<tool-${name}>[\\S\\s]*?</tool-${name}>`))
				if (m) {
					a.AddLongTimeLog({ name: `tool-${name}`, role: 'tool', content: 'done' })
					a.MaskHandledCall(m[0], '')
				}
			}
			return true
		},
	])
	const rawEntry = result.logContextBefore.find(entry => entry.role === 'char')
	assertEquals(rawEntry.content.includes('<tool-a>'), true, 'agent 层保留原始标签')
	assertEquals(rawEntry.content_for_show.includes('<tool-a>'), false, '人类展示层不应残留工具调用标签')
	assertEquals(rawEntry.content_for_show.includes('<tool-b>'), false, '人类展示层不应残留工具调用标签')
	assertStringIncludes(rawEntry.content_for_show, '<details>思考</details>')
	assertStringIncludes(rawEntry.content_for_show, '再看')
})

Deno.test('纯工具调用生成的人类展示层不含裸标签（仅空白，供 UI 判空隐藏）', async () => {
	const result = makeResult('<view-file>\nsrc/a.mjs\n</view-file>')
	const args = makeArgs(result.content)
	await runReplyHandlers(result, args, [
		async (reply, a) => {
			const m = reply.content_for_handle.match(/<view-file>[\S\s]*?<\/view-file>/)
			if (!m) return false
			a.AddLongTimeLog({ name: 'file-operations.view-file', role: 'tool', content: 'done' })
			a.MaskHandledCall(m[0], '')
			return true
		},
	])
	const rawEntry = result.logContextBefore.find(entry => entry.role === 'char')
	assertEquals(rawEntry.content, '<view-file>\nsrc/a.mjs\n</view-file>')
	assertEquals(rawEntry.content_for_show.includes('<view-file>'), false, '不应残留原始标签')
	assertEquals(rawEntry.content_for_show.trim(), '', '纯工具调用的人类展示层应为空白')
})

Deno.test('无 handler 命中时直接返回且不改动日志', async () => {
	const result = makeResult('普通回复')
	const args = makeArgs(result.content)
	const wantRegen = await runReplyHandlers(result, args, [
		async () => false,
	])
	assertEquals(wantRegen, false)
	assertEquals(result.logContextBefore.length, 0)
	assertStringIncludes(result.content, '普通回复')
})
