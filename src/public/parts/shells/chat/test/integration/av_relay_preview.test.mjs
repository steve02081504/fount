/**
 * AV relay preview 订阅档位：只转发 video keyframe，不转发音频 / delta。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	AV_RELAY_HEADER_SIZE,
	registerAvRelaySocket,
} from '../../src/chat/ws/avRelay.mjs'

/**
 *
 */
class FakeWs extends EventEmitter {
	readyState = 1
	/** @type {{ data: Buffer | string, binary?: boolean }[]} */
	sent = []
	/**
	 * @param {Buffer | string} data 数据
	 * @param {{ binary?: boolean }} [options] 选项
	 * @returns {void}
	 */
	send(data, options) {
		this.sent.push({ data, binary: !!options?.binary })
	}
}

/**
 * @param {number} frameType 0=video 1=audio
 * @param {boolean} isKey keyframe
 * @param {number} [payloadLen=8] 载荷长度
 * @returns {Buffer} 帧
 */
function buildFrame(frameType, isKey, payloadLen = 8) {
	const buf = Buffer.alloc(AV_RELAY_HEADER_SIZE + payloadLen)
	buf[0] = frameType
	buf[1] = isKey ? 1 : 0
	buf.writeUInt32BE(1, 2)
	buf.fill(0xab, AV_RELAY_HEADER_SIZE)
	return buf
}

Deno.test('avRelay preview peer receives throttled video keyframes only', async () => {
	const roomId = `preview-test:${Date.now()}`
	const publisher = new FakeWs()
	const preview = new FakeWs()
	const full = new FakeWs()

	registerAvRelaySocket(roomId, publisher)
	registerAvRelaySocket(roomId, preview)
	registerAvRelaySocket(roomId, full)

	preview.emit('message', JSON.stringify({ type: 'subscribe', mode: 'preview' }), false)
	full.emit('message', JSON.stringify({ type: 'subscribe', mode: 'full' }), false)

	preview.sent = []
	full.sent = []

	const key = buildFrame(0, true)
	publisher.emit('message', key, true)
	assertEquals(preview.sent.filter(row => row.binary).length, 1)
	assertEquals(full.sent.filter(row => row.binary).length, 1)

	preview.sent = []
	full.sent = []
	const delta = buildFrame(0, false)
	publisher.emit('message', delta, true)
	assertEquals(preview.sent.filter(row => row.binary).length, 0, 'preview must drop video delta')
	assertEquals(full.sent.filter(row => row.binary).length, 1)

	preview.sent = []
	full.sent = []
	const audio = buildFrame(1, true)
	publisher.emit('message', audio, true)
	assertEquals(preview.sent.filter(row => row.binary).length, 0, 'preview must drop audio')
	assertEquals(full.sent.filter(row => row.binary).length, 1)

	// 关键帧节流：立即再发 key 应被挡住
	preview.sent = []
	publisher.emit('message', buildFrame(0, true, 9), true)
	assertEquals(preview.sent.filter(row => row.binary).length, 0, 'preview keyframe throttle')

	publisher.emit('close')
	preview.emit('close')
	full.emit('close')
	assert(true)
})
