/**
 * view-log 与 persona 主观滤镜；world 先于 persona；内置 world/persona 兜底。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'viewer_agent'
const WORLD = 'human_viewer'
const PERSONA = 'viewer_persona'
const ORDER_KEY = '__fount_viewer_persona_order__'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedHumanViewerFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const copies = [
		{ from: join(fixturesRoot, 'chars', CHAR), to: join(userRoot, 'chars', CHAR) },
		{ from: join(fixturesRoot, 'worlds', WORLD), to: join(userRoot, 'worlds', WORLD) },
		{ from: join(fixturesRoot, 'personas', PERSONA), to: join(userRoot, 'personas', PERSONA) },
	]
	for (const { from, to } of copies) {
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * @returns {Promise<{
 *   username: string,
 *   groupId: string,
 *   channelId: string,
 *   messageTexts: (rows: object[]) => string[],
 * }>} 群上下文
 */
async function setupHumanViewerGroup() {
	const username = `vh-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_viewer_human_',
		minP2pNode: true,
		/**
		 * @param {string} user 登录用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedHumanViewerFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar, setWorld, setPersona } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'viewer-human' })
	const channelId = await getDefaultChannelId(username, groupId)
	await setWorld(groupId, channelId, WORLD, username)
	await setPersona(groupId, PERSONA, username)

	await postChannelMessage(username, groupId, channelId, { text: 'hello visible' })
	await postChannelMessage(username, groupId, channelId, { text: 'secret hidden-marker payload' })
	await postChannelMessage(username, groupId, channelId, { text: 'persona-hide-me private note' })
	await postChannelMessage(username, groupId, channelId, { text: 'please world-rewrite-me now' })
	await postChannelMessage(username, groupId, channelId, { text: 'please persona-rewrite-me now' })

	await addchar(groupId, CHAR, username)

	/**
	 * @param {object[]} rows 消息行
	 * @returns {string[]} 正文列表
	 */
	const messageTexts = rows => rows
		.filter(row => row.type === 'message')
		.map(row => String(row.content?.content_for_show ?? row.content?.content ?? ''))

	return { username, groupId, channelId, messageTexts }
}

Deno.test('view-log: hide/rewrite + world-before-persona + agent parity', async () => {
	globalThis[ORDER_KEY] = undefined
	const { username, groupId, channelId, messageTexts } = await setupHumanViewerGroup()
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { readViewerChannelMessages } = await import('../../src/chat/session/materializeViewerLog.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')

	const raw = await readChannelMessagesForUser(username, groupId, channelId, { limit: 50 })
	const rawTexts = messageTexts(raw)
	assert(rawTexts.some(text => text.includes('hidden-marker')), `raw keeps world-hidden; got=${JSON.stringify(rawTexts)}`)
	assert(rawTexts.some(text => text.includes('persona-hide-me')), `raw keeps persona-hidden; got=${JSON.stringify(rawTexts)}`)
	assert(rawTexts.some(text => text.includes('world-rewrite-me')), `raw keeps pre-rewrite world text; got=${JSON.stringify(rawTexts)}`)
	assert(rawTexts.some(text => text.includes('persona-rewrite-me')), `raw keeps pre-rewrite persona text; got=${JSON.stringify(rawTexts)}`)

	const { messages } = await readViewerChannelMessages(username, groupId, channelId, { limit: 50 })
	const viewTexts = messageTexts(messages)
	assert(viewTexts.some(text => text.includes('hello visible')), 'visible kept')
	assert(!viewTexts.some(text => text.includes('hidden-marker')), 'world hide on view-log')
	assert(!viewTexts.some(text => text.includes('persona-hide-me')), 'persona hide on view-log')
	assert(viewTexts.some(text => text.includes('world-rewritten')), `world rewrite on view-log; got=${JSON.stringify(viewTexts)}`)
	assert(viewTexts.some(text => text.includes('persona-rewritten')), `persona rewrite on view-log; got=${JSON.stringify(viewTexts)}`)
	assert(messages.some(row => row.extension?.viewerRewritten), 'viewerRewritten flag')

	assertEquals(globalThis[ORDER_KEY]?.called, true)
	assertEquals(globalThis[ORDER_KEY]?.worldHiddenStillPresent, false)

	const request = await getChatRequest(groupId, CHAR, channelId, { replicaUsername: username })
	const agentTexts = (request.chat_log || []).map(entry => String(entry.content || ''))
	assert(!agentTexts.some(text => text.includes('hidden-marker')), 'agent world hide')
	assert(agentTexts.some(text => text.includes('world-rewritten')), 'agent world rewrite')

	const { messages: charMessages } = await readViewerChannelMessages(username, groupId, channelId, { limit: 50 }, {
		kind: 'char',
		charname: CHAR,
	})
	const charViewTexts = messageTexts(charMessages)
	assert(!charViewTexts.some(text => text.includes('hidden-marker')), 'char view-log hide')
	assert(charViewTexts.some(text => text.includes('world-rewritten')), 'char view-log rewrite')
	assert(charViewTexts.some(text => text.includes('persona-hide-me')), 'persona hide is user-only')
})

Deno.test('builtin world/persona: unbound group view-log works', async () => {
	const username = `vb-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_viewer_builtin_',
		minP2pNode: true,
	})
	await ensureServer()
	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { readViewerChannelMessages } = await import('../../src/chat/session/materializeViewerLog.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')
	const { BUILTIN_WORLD, BUILTIN_PERSONA } = await import('../../src/chat/session/builtinParts.mjs')
	const { getGroupRuntime } = await import('../../src/chat/session/runtime.mjs')

	const groupId = await newGroup(username, { name: 'viewer-builtin' })
	const channelId = await getDefaultChannelId(username, groupId)
	await postChannelMessage(username, groupId, channelId, { text: 'builtin visible' })

	const world = await resolveWorld(groupId, channelId, username)
	assertEquals(world, BUILTIN_WORLD)
	const runtime = await getGroupRuntime(groupId, username)
	assertEquals(runtime.LastTimeSlice.player, BUILTIN_PERSONA)

	const { messages } = await readViewerChannelMessages(username, groupId, channelId, { limit: 20 })
	const texts = messages
		.filter(row => row.type === 'message')
		.map(row => String(row.content?.content || ''))
	assert(texts.some(text => text.includes('builtin visible')))
})
