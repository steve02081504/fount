/**
 * av-relay publish_meta 缓存 / 补发 / 撤销。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	getAvRelayPublishMetaList,
	registerAvRelaySocket,
} from '../../src/chat/ws/avRelay.mjs'

class FakeWs extends EventEmitter {
	readyState = 1
	/** @type {string[]} */
	sent = []
	/**
	 * @param {string} data
	 * @returns {void}
	 */
	send(data) { this.sent.push(String(data)) }
}

Deno.test('publish_meta cached and sent to new peer; revoked on disconnect', async () => {
	const roomId = `meta-test:${Date.now()}`
	const pub = new FakeWs()
	const sub = new FakeWs()

	registerAvRelaySocket(roomId, pub)
	pub.emit('message', JSON.stringify({
		type: 'hello',
		senderId: 'aa'.repeat(16),
	}), false)
	pub.emit('message', JSON.stringify({
		type: 'publish_meta',
		senderId: 'aa'.repeat(16),
		video: null,
		audio: { codec: 'opus' },
	}), false)

	assertEquals(getAvRelayPublishMetaList(roomId).length, 1)
	registerAvRelaySocket(roomId, sub)
	assert(sub.sent.some(t => t.includes('publish_meta')))

	pub.emit('close')
	assertEquals(getAvRelayPublishMetaList(roomId).length, 0)
	sub.emit('close')
	assert(true)
})
