/**
 * M2：写路径统一 — BeforeUserSend + world Add/After 单点触发 + Hub/CLI 同源。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { writePathHookState } from '../fixtures/write_path_hook_state.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const WORLD = 'write_path_hooks'
const PERSONA = 'write_path_persona'
const CHAR = 'write_path_agent'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedWritePathFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const copies = [
		{ from: join(fixturesRoot, 'worlds', WORLD), to: join(userRoot, 'worlds', WORLD) },
		{ from: join(fixturesRoot, 'personas', PERSONA), to: join(userRoot, 'personas', PERSONA) },
		{ from: join(fixturesRoot, 'chars', CHAR), to: join(userRoot, 'chars', CHAR) },
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
 *   hooks: ReturnType<typeof writePathHookState>,
 * }>} 会话上下文
 */
async function setupWritePathSession() {
	const hooks = writePathHookState()
	hooks.reset()
	const username = `wp-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_write_path_',
		minP2pNode: true,
		/**
		 * @param {string} user 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedWritePathFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { setPersona, setWorld } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	const groupId = await newGroup(username, { name: 'write-path' })
	const channelId = await getDefaultChannelId(username, groupId)
	await setPersona(groupId, PERSONA, username)

	hooks.reset()
	const greeting = await setWorld(groupId, channelId, WORLD, username)
	assert(greeting, 'world greeting inserted')
	assertEquals(hooks.addCalls.length, 1, 'greeting Add once at setup')
	assertEquals(hooks.afterCalls.length, 1, 'greeting After once at setup')

	return { username, groupId, channelId, hooks }
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>} 消息行
 */
async function listMessages(username, groupId, channelId) {
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	return readChannelMessagesForUser(username, groupId, channelId, { limit: 100 })
}

Deno.test('world greeting triggers Add/After exactly once and lands on DAG', async () => {
	const { username, groupId, channelId, hooks } = await setupWritePathSession()
	assertEquals(hooks.addCalls.length, 1, 'greeting Add once')
	assertEquals(hooks.afterCalls.length, 1, 'greeting After once')
	const messages = await listMessages(username, groupId, channelId)
	const greeting = messages.find(row => String(row.content?.content || '').includes('world-greeting'))
	assert(greeting, 'greeting on DAG')
	assert(greeting.content?.displayName, 'canonical displayName on generation message')
	assert(greeting.content?.sessionSnapshot || greeting.content?.chatLogEntryId, 'generation sidecar fields')
})

Deno.test('Hub postChannelMessage: BeforeUserSend rewrite + Add/After once + displayName', async () => {
	const { username, groupId, channelId, hooks } = await setupWritePathSession()
	const beforeCount = hooks.beforeSendCalls.length
	const addCount = hooks.addCalls.length
	const afterCount = hooks.afterCalls.length

	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	await postChannelMessage(username, groupId, channelId, { text: 'hello persona-rewrite-me hub' })

	assertEquals(hooks.beforeSendCalls.length, beforeCount + 1)
	assertEquals(hooks.addCalls.length, addCount + 1)
	assertEquals(hooks.afterCalls.length, afterCount + 1)

	const messages = await listMessages(username, groupId, channelId)
	const hit = messages.find(row => String(row.content?.content || '').includes('persona-rewritten'))
	assert(hit, 'persona rewrite landed')
	assert(!String(hit.content?.content || '').includes('persona-rewrite-me'))
	assert(hit.content?.displayName, 'human message has displayName')
	assert(!hit.content?.sessionSnapshot, 'human message has no sessionSnapshot')
})

Deno.test('CLI actions.send shares postChannelMessage path with BeforeUserSend reject', async () => {
	const { username, groupId, channelId, hooks } = await setupWritePathSession()
	const { actions } = await import('../../src/actions.mjs')

	await assertRejects(
		() => actions.send({ groupId, message: { content: 'please persona-reject-me' } }),
		Error,
		'persona rejected send',
	)
	assert(hooks.beforeSendCalls.some(call => String(call.text || '').includes('persona-reject-me')))

	const addBefore = hooks.addCalls.length
	const afterBefore = hooks.afterCalls.length
	await actions.send({ groupId, message: { content: 'cli ok via shared path' } })
	assertEquals(hooks.addCalls.length, addBefore + 1)
	assertEquals(hooks.afterCalls.length, afterBefore + 1)

	const messages = await listMessages(username, groupId, channelId)
	assert(messages.some(row => String(row.content?.content || '').includes('cli ok via shared path')))
})

Deno.test('world AddChatLogEntry can rewrite human content before DAG', async () => {
	const { username, groupId, channelId } = await setupWritePathSession()
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	await postChannelMessage(username, groupId, channelId, { text: 'please world-rewrite-me now' })
	const messages = await listMessages(username, groupId, channelId)
	const hit = messages.find(row => String(row.content?.content || '').includes('world-rewritten'))
	assert(hit)
	assertStringIncludes(String(hit.content.content), 'world-rewritten')
})

Deno.test('triggerCharReply finalize fires Add/After once on message_edit', async () => {
	const { username, groupId, channelId, hooks } = await setupWritePathSession()
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')

	await addchar(groupId, CHAR, username)
	hooks.reset()
	await triggerCharReply(groupId, channelId, CHAR)
	// triggerCharReply 异步启动 executeGeneration，需等到 finalize
	const start = Date.now()
	while (hooks.afterCalls.length < 1 && Date.now() - start < 10000)
		await new Promise(resolve => setTimeout(resolve, 40))
	assertEquals(hooks.addCalls.length, 1, 'char reply Add once (finalize)')
	assertEquals(hooks.afterCalls.length, 1, 'char reply After once (message_edit)')
	assertEquals(hooks.addCalls[0]?.content, 'write_path_agent reply')

	const messages = await listMessages(username, groupId, channelId)
	const charReply = messages.find(row => String(row.content?.content || '').includes('write_path_agent reply'))
	assert(charReply, 'char reply on DAG')
	assertEquals(charReply.content?.displayName, '写路径 Agent')
	assertEquals(charReply.content?.displayAvatar, '🤖')
	assertNotEquals(charReply.content?.displayName, '写路径测试人格')
})
