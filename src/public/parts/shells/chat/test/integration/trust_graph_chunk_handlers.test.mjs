/**
 * TrustGraph chunk responder 挂载：须把 room 传给 fount-p2p（无 username 首参）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { attachTrustGraphChunkHandlers } from '../../src/chat/federation/chunks.mjs'
import { waitUntil } from '../harness.mjs'

Deno.test('attachTrustGraphChunkHandlers registers fed_chunk actions on room', async () => {
	/** @type {string[]} */
	const actions = []
	const room = {
		/**
		 * @param {string} name action 名
		 * @returns {[() => void, () => void]} send / get
		 */
		makeAction(name) {
			actions.push(name)
			return [() => {}, () => {}]
		},
	}
	/** @type {unknown[][]} */
	const warns = []
	const origWarn = console.warn
	console.warn = (...args) => {
		warns.push(args)
		origWarn(...args)
	}
	try {
		await attachTrustGraphChunkHandlers(room, { enqueue() {} }, {}, 'room-key')
		await waitUntil(
			() => actions.includes('fed_chunk_data') || warns.some(args => String(args[0]).includes('trust-graph')),
			15_000,
		)
		const trustWarns = warns
			.filter(args => String(args[0]).includes('trust-graph'))
			.map(args => String(args[1] ?? args[0]))
		assertEquals(trustWarns, [], `trust-graph attach must not warn: ${trustWarns.join('; ')}`)
		for (const name of ['fed_chunk_data', 'fed_chunk_get', 'fed_manifest_data', 'fed_manifest_get'])
			assert(actions.includes(name), `missing makeAction(${name})`)
	}
	finally {
		console.warn = origWarn
	}
})
