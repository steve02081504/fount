/**
 * 角色消息展示快照：charId 路径不得回落到宿主 persona profile。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const PERSONA = 'write_path_persona'
const CHAR = 'write_path_agent'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	for (const [part, name] of [['personas', PERSONA], ['chars', CHAR]]) {
		const to = join(userRoot, part, name)
		await mkdir(dirname(to), { recursive: true })
		await cp(join(fixturesRoot, part, name), to, { recursive: true })
	}
}

/**
 * @returns {Promise<{ username: string, groupId: string, channelId: string }>} 会话上下文
 */
async function setupSession() {
	const username = `ds-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_display_snapshot_',
		minP2pNode: true,
		/** @param {string} user 用户 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/entity_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { setPersona, addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	const groupId = await newGroup(username, { name: 'display-snapshot' })
	const channelId = await getDefaultChannelId(username, groupId)
	await setPersona(groupId, PERSONA, username)
	await addchar(groupId, CHAR, username)

	return { username, groupId, channelId }
}

Deno.test('resolveDisplaySnapshot: char message uses char part not host persona', async () => {
	const { username, groupId } = await setupSession()
	const { resolveDisplaySnapshot } = await import('../../src/chat/archive/postSnapshot.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { resolveLocalEventSigner } = await import('../../src/chat/dag/localSigner.mjs')

	const [{ sender }, { state }] = await Promise.all([
		resolveLocalEventSigner(username, groupId),
		getState(username, groupId),
	])

	const human = await resolveDisplaySnapshot(state, { sender }, username, groupId)
	const agent = await resolveDisplaySnapshot(state, { sender, charId: CHAR }, username, groupId)

	assertEquals(agent.name, '写路径 Agent')
	assertEquals(agent.avatar, '🤖')
	assertNotEquals(agent.name, human.name)
	assertNotEquals(agent.avatar, human.avatar)
	assert(human.name !== agent.name, 'human and char snapshots differ')
})

Deno.test('buildCanonicalMessageContent: char reply persists char displayName/avatar', async () => {
	const { username, groupId, channelId } = await setupSession()
	const { buildCanonicalMessageContent } = await import('../../src/chat/channel/messageCommit.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	await triggerCharReply(groupId, channelId, CHAR)
	const start = Date.now()
	let charRow = null
	while (!charRow && Date.now() - start < 10000) {
		const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 50 })
		charRow = messages.find(row => String(row.content?.content || '').includes('write_path_agent reply'))
		if (!charRow) await new Promise(resolve => setTimeout(resolve, 40))
	}
	assert(charRow, 'char reply landed on DAG')
	assertEquals(charRow.content?.displayName, '写路径 Agent')
	assertEquals(charRow.content?.displayAvatar, '🤖')
	assertNotEquals(charRow.content?.displayName, '写路径测试人格')

	const canonical = await buildCanonicalMessageContent(
		username,
		groupId,
		channelId,
		{ type: 'text', content: 'probe' },
		{ charId: CHAR, origin: 'char' },
	)
	assertEquals(canonical.displayName, '写路径 Agent')
	assertEquals(canonical.displayAvatar, '🤖')
})
