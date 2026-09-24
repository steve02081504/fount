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
	assertEquals(dialogue.events.at(-1).round, 3)
	assertEquals(replayDialogue(dialogue.events).map(message => message.content), ['hi', 'hello', 'bye'])
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
