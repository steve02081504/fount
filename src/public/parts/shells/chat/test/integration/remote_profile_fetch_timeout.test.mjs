/**
 * 远端 EVFS profile 拉取挂起时，fetchRemote 必须限时回落本地默认资料，不能拖死 HTTP/资料卡。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'
import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'remote-profile-timeout-user',
	p2p: false,
	minP2pNode: true,
})

/** 永不 resolve，模拟 EVFS 挂死。 */
function hungReadPlain() {
	return new Promise(() => { })
}

Deno.test('getProfile fetchRemote times out hung EVFS and returns local default', async () => {
	await ensureServer()
	const { getProfile } = await import('../../src/entity/profile.mjs')
	const foreign = encodeEntityHash('b'.repeat(64), 'c'.repeat(64))

	const started = Date.now()
	const profile = await getProfile(foreign, username, {
		fetchRemote: true,
		readPlain: hungReadPlain,
		remoteTimeoutMs: 150,
	})
	const elapsed = Date.now() - started

	assert(elapsed < 2000, `fetchRemote hung for ${elapsed}ms`)
	assertEquals(profile.entityHash, foreign)
	assertEquals(profile.subjectHash, 'c'.repeat(64))
	assert(String(profile.name || '').length > 0, 'default presentation name required')
})

Deno.test('getProfile fetchRemote respects negative cache after hung miss', async () => {
	await ensureServer()
	const { getProfile } = await import('../../src/entity/profile.mjs')
	const foreign = encodeEntityHash('d'.repeat(64), 'e'.repeat(64))
	let calls = 0
	/**
	 * @returns {Promise<never>} 永不返回
	 */
	const countingHung = () => {
		calls += 1
		return new Promise(() => { })
	}

	await getProfile(foreign, username, {
		fetchRemote: true,
		readPlain: countingHung,
		remoteTimeoutMs: 100,
	})
	assertEquals(calls, 1)

	const started = Date.now()
	await getProfile(foreign, username, {
		fetchRemote: true,
		readPlain: countingHung,
		remoteTimeoutMs: 100,
	})
	assert(Date.now() - started < 80, 'negative cache should skip second remote wait')
	assertEquals(calls, 1)
})

Deno.test('getProfile fetchRemote uses injected local plain without waiting on network', async () => {
	await ensureServer()
	const { getProfile } = await import('../../src/entity/profile.mjs')
	const foreign = encodeEntityHash('f'.repeat(64), 'a'.repeat(64))
	const plain = Buffer.from(JSON.stringify({
		entityHash: foreign,
		handle: 'cached-peer',
		localized: { 'en-UK': { name: 'Cached Peer', avatar: '', description: 'from cache' } },
	}), 'utf8')

	const profile = await getProfile(foreign, username, {
		fetchRemote: true,
		forceRemote: true,
		/** @returns {Promise<Buffer>} 预置的 profile JSON 明文 */
		readPlain: async () => plain,
		remoteTimeoutMs: 100,
	})
	assertEquals(profile.handle, 'cached-peer')
	assertEquals(profile.name, 'Cached Peer')
})
