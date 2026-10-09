/* global Deno */
const test = Deno.test
import assert from 'node:assert/strict'

const { createNetworkVerificationService } = await import('../../p2p_server/verification_service.mjs')

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

test('network verification needs authenticated claim and requester receipt', async () => {
	// 两个服务互相回调，所以先各自建好：闭包只在 prove/receive 真正发消息时才会读到对方。
	const b = createNetworkVerificationService({ nodeHash: B,
		/**
		 * @param {string} peer target
		 * @param {string} action operation
		 * @param {object} payload message
		 * @returns {Promise<boolean>} delivery
		 */
		send: async (peer, action, payload) => {
			assert.equal(peer, A)
			await a.receive(action, payload, B)
			return true
		} })
	const a = createNetworkVerificationService({ nodeHash: A,
		/**
		 * @param {string} peer target
		 * @param {string} action operation
		 * @param {object} payload message
		 * @returns {Promise<boolean>} delivery
		 */
		send: async (peer, action, payload) => {
			assert.equal(peer, B)
			await b.receive(action, payload, A)
			return true
		} })
	const challenge = a.create()
	assert.equal(a.get(challenge.challenge).status, 'pending')
	assert.deepEqual(await b.prove(challenge), { status: 'verified', nodeHash: B })
	assert.equal(a.get(challenge.challenge).nodeHash, B)
	await a.receive('verification_claim', challenge, C)
	assert.equal(a.get(challenge.challenge).nodeHash, B)
})

test('wrong secret, wrong deadline and expired claims cannot verify', async () => {
	let now = 1000
	const a = createNetworkVerificationService({ nodeHash: A,
		now: /** @returns {number} 当前时间 */ () => now,
		/** @returns {Promise<boolean>} 是否发送 */
		send: async () => true })
	const challenge = a.create({ timeoutMs: 100 })
	await a.receive('verification_claim', { ...challenge, challenge: C }, B)
	await a.receive('verification_claim', { ...challenge, expiresAt: 1101 }, B)
	assert.equal(a.get(challenge.challenge).status, 'pending')
	now = 1100
	await a.receive('verification_claim', challenge, B)
	assert.equal(a.get(challenge.challenge).status, 'failed')
	assert.equal(a.get(challenge.challenge).reason, 'timeout')
})

test('unreachable nodes and invalid challenge fail explicitly', async () => {
	const a = createNetworkVerificationService({ nodeHash: A,
		/** @returns {Promise<boolean>} 是否发送 */
		send: async () => false })
	const b = createNetworkVerificationService({ nodeHash: B,
		/** @returns {Promise<boolean>} 是否发送 */
		send: async () => false })
	assert.equal((await b.prove(a.create())).reason, 'unreachable')
	assert.equal((await b.prove({ requesterNodeHash: A, challenge: C, expiresAt: 0 })).reason, 'invalid challenge')
	assert.throws(() => a.create({ timeoutMs: Infinity }))
})
