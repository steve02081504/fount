/**
 * vault 加密帖与 follow_approve。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const vault = await import('../../src/vault_crypto/vault.mjs')
const followApprove = await import('../../src/vault_crypto/followApprove.mjs')
const append = await import('../../src/timeline/append.mjs')
const fedExport = await import('../../src/timeline/federationExport.mjs')
const { publicKeyFromSeed, pubKeyHash } = await import('fount/scripts/p2p/crypto.mjs')

Deno.test('maybeEncryptPostContent roundtrips via maybeDecryptPostContent', async () => {
	const { username, operator } = await getSession()
	const postKeyId = randomUUID()
	const plain = { text: 'vault secret', visibility: 'followers', lang: 'zh-CN' }
	const enc = await vault.maybeEncryptPostContent(username, operator, postKeyId, plain, 'followers')
	assertEquals(enc.scheme, 'gsh')
	const dec = await vault.maybeDecryptPostContent(username, operator, enc)
	assertEquals(dec.text, 'vault secret')
})

Deno.test('maybeDecryptPostContent passes through public plaintext content', async () => {
	const { username, operator } = await getSession()
	const plain = { text: 'public hello', visibility: 'public', lang: 'zh-CN' }
	const dec = await vault.maybeDecryptPostContent(username, operator, plain)
	assertEquals(dec, plain)
})

Deno.test('buildFollowApprovePayload + autoApproveFollower emits follow_approve', async () => {
	const { username, operator } = await getSession()
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

Deno.test('encrypted followers post hidden from anonymous federation pull', async () => {
	const { username, operator } = await getSession()
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
	assertEquals(cipherPost.content?.visibility, 'followers')
	const exportedPost = exported.find(e => e.id === cipherPost.id)
	assert(!exportedPost, 'followers-only encrypted post must not export to anonymous requester')
})

Deno.test('encrypted followers post exports ciphertext to owner pull', async () => {
	const { username, operator } = await getSession()
	const postKeyId = randomUUID()
	const enc = await vault.maybeEncryptPostContent(
		username, operator, postKeyId,
		{ text: 'owner pull cipher', visibility: 'followers' },
		'followers',
	)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: enc,
	}, { fanout: false })

	const all = await append.readTimelineEvents(username, operator)
	const { getNodeHash } = await import('fount/scripts/p2p/node/identity.mjs')
	const exported = await fedExport.filterEventsForFederatedPull(username, operator, all, getNodeHash())
	const cipherPost = all.find(e => e.type === 'post' && e.content?.postKeyId === postKeyId)
	assert(cipherPost)
	const exportedPost = exported.find(e => e.id === cipherPost.id)
	assert(exportedPost, 'owner pull should receive followers ciphertext envelope')
	assertEquals(exportedPost.content?.scheme, 'gsh')
	assertEquals(exportedPost.content?.visibility, 'followers')
	assert(!exportedPost.content?.text, 'export must not leak plaintext')
})
