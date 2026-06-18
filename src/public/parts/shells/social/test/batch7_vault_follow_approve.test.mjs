/**
 * Batch 7：vault 加密帖与 follow_approve。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/social/test/batch7_vault_follow_approve.test.mjs
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap } from './harness.mjs'

const { username, operator } = await bootstrap()

const vault = await import('../src/vault_crypto/vault.mjs')
const followApprove = await import('../src/vault_crypto/followApprove.mjs')
const append = await import('../src/timeline/append.mjs')
const fedExport = await import('../src/timeline/federationExport.mjs')
const { publicKeyFromSeed, pubKeyHash } = await import('../../../../../scripts/p2p/crypto.mjs')

Deno.test('maybeEncryptPostContent roundtrips via maybeDecryptPostContent', async () => {
	const postKeyId = randomUUID()
	const plain = { text: 'vault secret', visibility: 'followers', lang: 'zh-CN' }
	const enc = await vault.maybeEncryptPostContent(username, operator, postKeyId, plain, 'followers')
	assertEquals(enc.scheme, 'gsh')
	const dec = await vault.maybeDecryptPostContent(username, operator, enc)
	assertEquals(dec.text, 'vault secret')
})

Deno.test('buildFollowApprovePayload + autoApproveFollower emits follow_approve', async () => {
	const seed = new Uint8Array(32).fill(7)
	const followerPubKeyHex = Buffer.from(publicKeyFromSeed(seed)).toString('hex')
	const payload = await vault.buildFollowApprovePayload(username, operator, followerPubKeyHex)
	assert(payload.targetPubKeyHex)
	assert(payload.encrypted_H)
	assert(payload.vaultGroupId)

	const ev = await followApprove.autoApproveFollower(username, operator, followerPubKeyHex)
	assertEquals(ev.type, 'follow_approve')
	assertEquals(ev.content.targetPubKeyHex, followerPubKeyHex)
})

Deno.test('encrypted followers post stays ciphertext in federation export', async () => {
	const postKeyId = randomUUID()
	const enc = await vault.maybeEncryptPostContent(
		username, operator, postKeyId,
		{ text: 'cipher body', visibility: 'followers' },
		'followers',
	)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: enc,
	}, { fanout: false })

	const all = await append.readTimelineEvents(username, operator)
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, null)
	const cipherPost = all.find(e => e.type === 'post' && e.content?.scheme === 'gsh')
	assert(cipherPost)
	const exportedPost = exported.find(e => e.id === cipherPost.id)
	if (exportedPost) {
		assertEquals(exportedPost.content?.scheme, 'gsh')
		assert(!exportedPost.content?.text, 'export must not leak plaintext')
	}
})
