/**
 * 主人远程更新资料：路径 / hash / 白名单 / 本机 publish→pull→ack purge。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { createIntegrationBoot, seedStubCharPart } from '../harness.mjs'

const { ensureServer, username, dataDir } = createIntegrationBoot({
	username: 'owner-profile-update-user',
	minP2pNode: true,
})

/**
 * @param {string} charPartName 占位角色名
 * @returns {Promise<void>}
 */
async function ensureStubChar(charPartName) {
	await ensureServer()
	await seedStubCharPart(dataDir, username, charPartName)
}

Deno.test('sanitizeOwnerProfileUpdates drops unknown fields', async () => {
	const { sanitizeOwnerProfileUpdates, hashOwnerProfileUpdateBody, ownedProfileUpdatePath } = await import(
		'../../src/entity/ownerProfileUpdate.mjs'
	)
	assertEquals(ownedProfileUpdatePath('ab'.repeat(64), 'profile.json'), `owned/${'ab'.repeat(64)}/profile_update/profile.json`)
	const cleaned = sanitizeOwnerProfileUpdates({
		localized: { 'zh-CN': { name: 'n' } },
		handle: 'hi',
		evil: 1,
		status: 'online',
	})
	assertEquals(cleaned.evil, undefined)
	assertEquals(cleaned.handle, 'hi')
	assertEquals(cleaned.status, 'online')
	const h1 = hashOwnerProfileUpdateBody({ a: 1, b: 2 })
	const h2 = hashOwnerProfileUpdateBody({ a: 1, b: 2 })
	assertEquals(h1, h2)
	assertEquals(h1.length, 64)
})

Deno.test('ensureAgentEntityIdentity backfills null ownerEntityHash', async () => {
	await ensureStubChar('owner_backfill_char')
	const {
		ensureAgentEntityIdentity,
		ensureOperatorIdentity,
		loadEntityIdentity,
		setEntityOwner,
		resolveCharPartNameForEntity,
	} = await import('../../src/entity/identity.mjs')

	const op = await ensureOperatorIdentity(username)
	const agent = await ensureAgentEntityIdentity(username, 'owner_backfill_char')
	assertEquals(String(agent.ownerEntityHash).toLowerCase(), String(op.entityHash).toLowerCase())

	await setEntityOwner(username, agent.entityHash, null)
	const cleared = await loadEntityIdentity(username, agent.entityHash)
	assertEquals(cleared.ownerEntityHash, null)

	const fixed = await ensureAgentEntityIdentity(username, 'owner_backfill_char')
	assertEquals(String(fixed.ownerEntityHash).toLowerCase(), String(op.entityHash).toLowerCase())
	const disk = await loadEntityIdentity(username, agent.entityHash)
	assertEquals(String(disk.ownerEntityHash).toLowerCase(), String(op.entityHash).toLowerCase())
	assertEquals(await resolveCharPartNameForEntity(username, agent.entityHash), 'owner_backfill_char')
})

Deno.test('isWritableLocalEntityForUser uses ownerEntityHash not charPartName alone', async () => {
	await ensureStubChar('owner_writable_char')
	const { ensureAgentEntityIdentity, ensureOperatorIdentity, setEntityOwner } = await import('../../src/entity/identity.mjs')
	const { isWritableLocalEntityForUser } = await import('../../src/entity/http.mjs')

	const op = await ensureOperatorIdentity(username)
	const agent = await ensureAgentEntityIdentity(username, 'owner_writable_char')
	assertEquals(await isWritableLocalEntityForUser(username, agent.entityHash), true)

	// 指向虚假主人后本用户不可写（即使仍有 charPartName）
	const fakeOwner = `${'cd'.repeat(32)}${'ef'.repeat(32)}`
	await setEntityOwner(username, agent.entityHash, fakeOwner)
	assertEquals(await isWritableLocalEntityForUser(username, agent.entityHash), false)

	await setEntityOwner(username, agent.entityHash, op.entityHash)
	assertEquals(await isWritableLocalEntityForUser(username, agent.entityHash), true)
})

Deno.test('publishOwnerProfileUpdate → pullOwnerProfileUpdate → ack purge', async () => {
	await ensureStubChar('owner_remote_profile_char')
	const { ensureAgentEntityIdentity, ensureOperatorIdentity, getEntityActivePubKey } = await import(
		'../../src/entity/identity.mjs'
	)
	const { getProfile, updateProfile } = await import('../../src/entity/profile.mjs')
	const {
		publishOwnerProfileUpdate,
		pullOwnerProfileUpdate,
		purgeOwnedProfilePublish,
		ownedProfileUpdatePath,
		hashOwnerProfileUpdateBody,
	} = await import('../../src/entity/ownerProfileUpdate.mjs')
	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const { getEntityStore } = await import('npm:@steve02081504/fount-p2p/node/instance')

	const op = await ensureOperatorIdentity(username)
	const agent = await ensureAgentEntityIdentity(username, 'owner_remote_profile_char')
	await updateProfile(username, agent.entityHash, {
		localized: { 'zh-CN': { name: 'before' } },
		activePubKeyHex: await getEntityActivePubKey(username, agent.entityHash),
	}, { skipPresentation: true })

	const queued = await publishOwnerProfileUpdate(username, op.entityHash, agent.entityHash, {
		localized: { 'zh-CN': { name: 'from-owner' } },
		handle: 'owned_agent',
	})
	assertEquals(queued.queued, true)
	assertEquals(queued.contentHash.length, 64)

	const plain = await readPublicFile(username, op.entityHash, ownedProfileUpdatePath(agent.entityHash, 'profile.json'))
	const payload = JSON.parse(plain.toString('utf8'))
	assertEquals(payload.contentHash, queued.contentHash)
	assertEquals(
		hashOwnerProfileUpdateBody({
			targetEntityHash: agent.entityHash,
			ownerEntityHash: op.entityHash,
			updates: { localized: payload.updates.localized, handle: payload.updates.handle },
			ts: payload.ts,
		}),
		queued.contentHash,
	)

	const applied = await pullOwnerProfileUpdate(username, agent.entityHash)
	assertEquals(applied.applied, true)
	assertEquals(applied.contentHash, queued.contentHash)

	const after = await getProfile(agent.entityHash, username, { skipPresentation: true })
	assertEquals(after.localized['zh-CN']?.name, 'from-owner')
	assertEquals(after.handle, 'owned_agent')

	// 同 ts 再拉应拒绝
	const again = await pullOwnerProfileUpdate(username, agent.entityHash)
	assertEquals(again.applied, false)

	await purgeOwnedProfilePublish(username, op.entityHash, agent.entityHash)
	const tomb = await readPublicFile(username, op.entityHash, ownedProfileUpdatePath(agent.entityHash, 'profile.json'))
	assertEquals(JSON.parse(tomb.toString('utf8')).tombstone, true)
	void getEntityStore
})

Deno.test('pullOwnerProfileUpdate rejects mismatched owner / bad shape', async () => {
	await ensureStubChar('owner_reject_char')
	const { ensureAgentEntityIdentity, ensureOperatorIdentity, getEntityRecoverySecretKey, getRecoveryPubKeyHex } = await import(
		'../../src/entity/identity.mjs'
	)
	const { publishPublicFile } = await import('npm:@steve02081504/fount-p2p/files/manifest/public')
	const { Buffer } = await import('node:buffer')
	const {
		pullOwnerProfileUpdate,
		ownedProfileUpdatePath,
		hashOwnerProfileUpdateBody,
	} = await import('../../src/entity/ownerProfileUpdate.mjs')

	const op = await ensureOperatorIdentity(username)
	const agent = await ensureAgentEntityIdentity(username, 'owner_reject_char')
	const ts = Date.now() + 10_000
	const fakeOwner = `${'11'.repeat(32)}${'22'.repeat(32)}`
	const body = {
		targetEntityHash: agent.entityHash,
		ownerEntityHash: fakeOwner,
		updates: { handle: 'nope' },
		ts,
	}
	const contentHash = hashOwnerProfileUpdateBody(body)
	const recoverySecretKeyHex = await getEntityRecoverySecretKey(username, op.entityHash)
	const recoveryPubKeyHex = await getRecoveryPubKeyHex(username, op.entityHash)
	await publishPublicFile({
		ownerEntityHash: op.entityHash,
		logicalPath: ownedProfileUpdatePath(agent.entityHash, 'profile.json'),
		plaintext: Buffer.from(JSON.stringify({ ...body, contentHash }), 'utf8'),
		name: 'profile.json',
		mimeType: 'application/json',
		entitySecretKey: Buffer.from(recoverySecretKeyHex, 'hex'),
		entityPubKeyHex: recoveryPubKeyHex,
	})

	const result = await pullOwnerProfileUpdate(username, agent.entityHash)
	assertEquals(result.applied, false)
})

Deno.test('updateEntityProfileAsActor local path returns profile', async () => {
	await ensureServer()
	const { ensureOperatorIdentity } = await import('../../src/entity/identity.mjs')
	const { updateEntityProfileAsActor } = await import('../../src/entity/ownerProfileUpdate.mjs')
	const op = await ensureOperatorIdentity(username)
	const result = await updateEntityProfileAsActor(username, op.entityHash, op.entityHash, {
		localized: { 'zh-CN': { name: 'self-edit' } },
	})
	assertEquals(result.profile?.localized?.['zh-CN']?.name, 'self-edit')
	await assertRejects(
		() => updateEntityProfileAsActor(username, op.entityHash, `${'00'.repeat(64)}`, { handle: 'x' }),
		Error,
	)
})

Deno.test('published profile falls back to fount username as display name', async () => {
	await ensureServer()
	const { ensureOperatorIdentity } = await import('../../src/entity/identity.mjs')
	const { updateProfile } = await import('../../src/entity/profile.mjs')
	const op = await ensureOperatorIdentity(username)
	// 清空既有展示名再触发发布，验证未设置名时以 fount 用户名兜底。
	await updateProfile(username, op.entityHash, { themeColor: '#aabbcc', localized: {} }, { skipPresentation: true })
	const { readPublicFile } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const { Buffer } = await import('node:buffer')
	const plain = await readPublicFile(username, op.entityHash, 'profile.json')
	assertEquals(Boolean(plain), true)
	const payload = JSON.parse(Buffer.from(plain).toString('utf8'))
	const name = Object.values(payload.localized || {}).map(slice => slice?.name).find(Boolean)
	assertEquals(name, username)
})
