/**
 * Mock Speech Recognition：feed / audio 路径与缺参报错。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import generator from '../../main.mjs'

/**
 * @returns {Promise<object>} mock 源
 */
async function makeSource() {
	return generator.interfaces.serviceGenerator.GetSource({
		name: 'mock-test',
		text: '你好世界',
		chunk_delay_ms: 0,
		chunk_size: 2,
	})
}

Deno.test('mock Recognize audio 便捷路径返回全文并触发 onResult', async () => {
	const source = await makeSource()
	/** @type {string[]} */
	const partials = []
	const result = await source.Recognize({
		audio: { buffer: new Uint8Array([1, 2, 3]), mime_type: 'audio/wav' },
		/**
		 * @param {{ text: string }} partial 增量
		 * @returns {void}
		 */
		onResult: (partial) => { partials.push(partial.text) },
	})
	assertEquals(result.text, '你好世界')
	assertEquals(partials.at(-1), '你好世界')
	assertEquals(partials[0], '你好')
})

Deno.test('mock Recognize feed 分片输入后假流式出字', async () => {
	const source = await makeSource()
	/** @type {string[]} */
	const partials = []
	const result = await source.Recognize({
		/**
		 * @param {{ send: Function, end: Function }} ctl 控制面
		 * @returns {Promise<void>}
		 */
		feed: async (ctl) => {
			await ctl.send(new Uint8Array([9]))
			await ctl.send(new Uint8Array([8]))
			await ctl.end()
		},
		/**
		 * @param {{ text: string }} partial 增量
		 * @returns {void}
		 */
		onResult: (partial) => { partials.push(partial.text) },
	})
	assertEquals(result.text, '你好世界')
	assertEquals(partials.length >= 2, true)
	assertEquals(partials.at(-1), '你好世界')
})

Deno.test('mock Recognize 缺少 audio/feed 抛错', async () => {
	const source = await makeSource()
	await assertRejects(() => source.Recognize({}), Error, 'exactly one of audio or feed')
})

Deno.test('mock Recognize 同时提供 audio 与 feed 抛错', async () => {
	const source = await makeSource()
	await assertRejects(() => source.Recognize({
		audio: { buffer: new Uint8Array([1]), mime_type: 'audio/wav' },
		/**
		 * @returns {Promise<void>}
		 */
		feed: async () => { },
	}), Error, 'exactly one of audio or feed')
})
