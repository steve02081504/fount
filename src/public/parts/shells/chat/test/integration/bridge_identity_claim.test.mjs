/**
 * operator 平台身份认领集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedCharFixture(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const from = join(fixturesRoot, 'chars', CHAR_YES)
	const to = join(userRoot, 'chars', CHAR_YES)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

/**
 * @param {string} username replica
 * @param {string} operatorHash operator entityHash
 * @param {string} name profile 展示名
 * @returns {Promise<void>}
 */
async function seedOperatorProfileName(username, operatorHash, name) {
	const { getProfile, updateProfile } = await import('npm:@steve02081504/fount-p2p/entity/profile')
	const { normalizeLocalizedMap } = await import('fount/server/p2p_server/presentation.mjs')
	const profile = await getProfile(operatorHash, username, { skipPresentation: true })
	const localized = normalizeLocalizedMap(profile.localized)
	localized['zh-CN'] = { ...localized['zh-CN'], name }
	await updateProfile(username, operatorHash, { localized }, { skipPresentation: true })
}

Deno.test('claimOperatorBridgeIdentity writes identityMap entry', async () => {
	const username = `bridge-claim-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_claim_',
		minP2pNode: true,
	})
	await ensureServer()

	const { claimOperatorBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { bridgeIdentityKey, loadBridgesDoc } = await import('../../src/chat/bridge/store.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const ownerUid = 42424242
	await claimOperatorBridgeIdentity(username, 'telegram', ownerUid, 'TG Owner')

	const doc = loadBridgesDoc(username)
	assertEquals(doc.identityMap[bridgeIdentityKey('telegram', ownerUid)], operatorHash)
})

Deno.test('bound owner bridge message attributes operator entityHash', async () => {
	const username = `bridge-owner-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_owner_attr_',
		minP2pNode: true,
	})
	await ensureServer()

	const { claimOperatorBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const ownerUid = 51515151
	await claimOperatorBridgeIdentity(username, 'telegram', ownerUid, 'Owner')

	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 910001,
		chatKind: 'dm',
		platformMessageId: 21,
		author: { platformUserId: ownerUid, displayName: 'DTO Name' },
		text: 'owner speaks',
		timestamp: Date.now(),
	})

	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 910001,
	})
	const channelId = await getDefaultChannelId(username, groupId)
	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	const row = messages.find(message => message.eventId === event.id)
	assert(row)
	assertEquals(row.content?.extension?.bridge?.authorEntityHash, operatorHash)
})

Deno.test('bound owner message uses operator profile displayName', async () => {
	const username = `bridge-profile-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_profile_',
		minP2pNode: true,
	})
	await ensureServer()

	const { claimOperatorBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	await seedOperatorProfileName(username, operatorHash, 'Operator Profile Name')

	const ownerUid = 61616161
	await claimOperatorBridgeIdentity(username, 'telegram', ownerUid, 'DTO Fallback')

	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 910002,
		chatKind: 'group',
		platformMessageId: 22,
		author: { platformUserId: ownerUid, displayName: 'DTO Fallback' },
		text: 'profile display test',
		timestamp: Date.now(),
	})

	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 910002,
	})
	const channelId = await getDefaultChannelId(username, groupId)
	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	const row = messages.find(message => message.eventId === event.id)
	assert(row)
	assertEquals(row.content?.displayName, 'Operator Profile Name')
})

Deno.test('isCaredBy recognizes bound owner and not unbound stranger', async () => {
	const username = `bridge-care-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_care_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { claimOperatorBridgeIdentity, bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { setCared, isCaredBy } = await import('../../src/chat/lib/care.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)
	const charHash = agentEntityHash(getNodeHash(), `chars/${CHAR_YES}`).toLowerCase()

	const ownerUid = 71717171
	const strangerUid = 81818181
	await claimOperatorBridgeIdentity(username, 'telegram', ownerUid, 'Owner')
	await setCared(username, charHash, operatorHash, true)

	assert(await isCaredBy(username, charHash, operatorHash))
	assertEquals(await isCaredBy(username, charHash, bridgeEntityHash('telegram', strangerUid)), false)
})
