/* global Deno */
/**
 * dialogueReplay 纯函数测试：从逐轮请求复原连续对话、按 id 去重、保留编辑并按轮次复播。
 */
import { assertEquals } from 'jsr:@std/assert'

import { buildDialogue, replayDialogue } from '../../public/shared/dialogueReplay.mjs'

/**
 * 构造逐轮请求快照。
 * @param {number} index 轮次
 * @param {object[]} messages 消息
 * @returns {object} 请求
 */
function request(index, messages) {
	return { index, messages }
}

Deno.test('buildDialogue dedupes repeated messages by id and appends the final reply', () => {
	const requests = [
		request(1, [{ id: 'm1', role: 'user', name: 'u', content: 'hi' }]),
		request(2, [
			{ id: 'm1', role: 'user', name: 'u', content: 'hi' },
			{ id: 'm2', role: 'char', name: 'c', content: 'hello' },
		]),
	]
	const dialogue = buildDialogue(requests, { response: 'bye', responseId: 'final' })
	assertEquals(dialogue.rounds, 2)
	assertEquals(dialogue.events.map(event => event.op), ['insert', 'insert', 'insert'])
	assertEquals(dialogue.events[1].round, 1)
	assertEquals(replayDialogue(dialogue.events, { upToRound: 1 }).map(message => message.content), ['hi', 'hello'])
	// 最终回复是末轮请求的输出，与末轮同轮次（不新增幻影轮），否则多代合并复播会整体错位
	assertEquals(dialogue.events.at(-1).round, 2)
	assertEquals(replayDialogue(dialogue.events, { upToRound: 2 }).map(message => message.content), ['hi', 'hello', 'bye'])
})

Deno.test('buildDialogue attributes tool results to the request that produced them, not the next prompt', () => {
	const dialogue = buildDialogue([
		request(1, [{ id: 'question', role: 'user', content: 'version?' }]),
		request(2, [
			{ id: 'question', role: 'user', content: 'version?' },
			{ id: 'call', role: 'char', content: '<grep>express</grep>' },
			{ id: 'tool', role: 'tool', content: 'express@5.2.1' },
		]),
		request(3, [
			{ id: 'question', role: 'user', content: 'version?' },
			{ id: 'call', role: 'char', content: '<grep>express</grep>' },
			{ id: 'tool', role: 'tool', content: 'express@5.2.1' },
			{ id: 'second-call', role: 'char', content: '<run-pwsh>deno info</run-pwsh>' },
			{ id: 'second-tool', role: 'tool', content: 'resolved express@5.2.1' },
		]),
	], { response: 'Express 5.2.1', responseId: 'final' })
	assertEquals(dialogue.events.map(event => event.round), [1, 1, 1, 2, 2, 3])
	assertEquals(replayDialogue(dialogue.events, { upToRound: 1 }).map(message => message.content), ['version?', '<grep>express</grep>', 'express@5.2.1'])
	assertEquals(replayDialogue(dialogue.events, { upToRound: 2 }).at(-1).content, 'resolved express@5.2.1')
})

Deno.test('buildDialogue places a reply without requests at round 1', () => {
	const dialogue = buildDialogue([], { response: 'only', responseId: 'final' })
	assertEquals(dialogue.rounds, 1)
	assertEquals(dialogue.events.map(event => event.round), [1])
	assertEquals(replayDialogue(dialogue.events, { upToRound: 1 }).map(message => message.content), ['only'])
})

Deno.test('buildDialogue records an edit at the round it happens and replay advances content', () => {
	const requests = [
		request(1, [{ id: 'm1', role: 'char', name: 'c', content: 'v1' }]),
		request(2, [{ id: 'm1', role: 'char', name: 'c', content: 'v2' }]),
	]
	const dialogue = buildDialogue(requests)
	assertEquals(dialogue.events.map(event => event.op), ['insert', 'update'])
	assertEquals(dialogue.events[1].round, 2)
	assertEquals(replayDialogue(dialogue.events, { upToRound: 1 })[0].content, 'v1')
	assertEquals(replayDialogue(dialogue.events, { upToRound: 2 })[0].content, 'v2')
})
