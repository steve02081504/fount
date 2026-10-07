/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { normalizeNodeIceServers } from '../../p2p_server/ice_servers.mjs'

Deno.test('node ICE settings keep valid TURN credentials and drop malformed entries', () => {
	const result = normalizeNodeIceServers([
		{ urls: 'turns:turn.example.test:5349', username: 'node-user', credential: 'private-secret' },
		{ urls: 'https://invalid.example.test' },
		{ urls: 'turn:missing-credential.example.test', username: 'incomplete' },
		{ urls: 'stun:stun.example.test:3478' },
	])

	assertEquals(result, [
		{ urls: 'turns:turn.example.test:5349', username: 'node-user', credential: 'private-secret' },
		{ urls: 'stun:stun.example.test:3478' },
	])
})

Deno.test('node ICE settings collapse one-element URL arrays and preserve paired credentials', () => {
	assertEquals(normalizeNodeIceServers([
		{ urls: ['turn:turn.example.test:3478'], username: 'node-user', credential: 'private-secret' },
	]), [{ urls: 'turn:turn.example.test:3478', username: 'node-user', credential: 'private-secret' }])
})

Deno.test('node ICE settings deduplicate before the package cap of twelve', () => {
	const entries = []
	for (let i = 0; i < 12; i++)
		entries.push({ urls: `stun:stun-${i}.example.test:3478` }, { urls: `stun:stun-${i}.example.test:3478` })
	entries.push({ urls: 'turn:turn-last.example.test:3478', username: 'u', credential: 'c' })

	const result = normalizeNodeIceServers(entries)
	assertEquals(result.length, 12)
	assertEquals(result.at(-1), { urls: 'stun:stun-11.example.test:3478' })
})

Deno.test('node ICE settings collapse equivalent spellings before the package cap of twelve', () => {
	const entries = []
	for (let i = 0; i < 12; i++)
		entries.push(i % 2
			? { urls: ['stun:stun-0.example.test:3478'], comment: i }
			: { comment: i, urls: 'stun:stun-0.example.test:3478' })
	entries.push({ urls: 'turn:turn-last.example.test:3478', username: 'u', credential: 'c' })

	assertEquals(normalizeNodeIceServers(entries), [
		{ urls: 'stun:stun-0.example.test:3478' },
		{ urls: 'turn:turn-last.example.test:3478', username: 'u', credential: 'c' },
	])
})

Deno.test('node ICE settings treat key order, extra fields and blank credentials as one entry', () => {
	assertEquals(normalizeNodeIceServers([
		{ urls: 'turn:turn.example.test:3478', username: 'node-user', credential: 'private-secret' },
		{ credential: 'private-secret', urls: ['turn:turn.example.test:3478'], username: 'node-user' },
		{ urls: 'turn:turn.example.test:3478', username: 'node-user', credential: 'private-secret', comment: 'dup' },
	]), [{ urls: 'turn:turn.example.test:3478', username: 'node-user', credential: 'private-secret' }])

	assertEquals(normalizeNodeIceServers([
		{ urls: 'stun:stun.example.test:3478', username: '', credential: '' },
		{ urls: ['stun:stun.example.test:3478'] },
	]), [{ urls: 'stun:stun.example.test:3478' }])
})

Deno.test('empty and invalid node ICE settings fall back to package defaults', () => {
	assertEquals(normalizeNodeIceServers(null), normalizeNodeIceServers([]))
	assertEquals(normalizeNodeIceServers([{ urls: 'https://invalid.example.test' }]), normalizeNodeIceServers([]))
})
