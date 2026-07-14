/**
 * channel edit/delete 钩子 + world GetCharReply 拦截集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { editPathHookState } from '../fixtures/edit_path_hook_state.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const WORLD = 'edit_path_world'
const PERSONA = 'edit_path_persona'
const CHAR = 'getcharreply_char'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedEditPathFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	for (const [kind, name] of [
		['worlds', WORLD],
		['personas', PERSONA],
		['chars', CHAR],
	]) {
		const from = join(fixturesRoot, kind, name)
		const to = join(userRoot, kind, name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * @returns {Promise<{ username: string, groupId: string, channelId: string }>} 就绪的测试会话标识
 */
async function setupEditPathSession() {
	editPathHookState().reset()
	const username = `edit-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_edit_path_',
		minP2pNode: true,
		/**
		 * @param {string} user 新建的测试用户名
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedEditPathFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { setPersona, setWorld } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	const groupId = await newGroup(username, { name: 'edit-path-hooks' })
	const channelId = await getDefaultChannelId(username, groupId)
	await setPersona(groupId, PERSONA, username)
	await setWorld(groupId, channelId, WORLD, username)
	editPathHookState().reset()
	return { username, groupId, channelId }
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>} 频道消息行
 */
async function listMessages(username, groupId, channelId) {
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	return readChannelMessagesForUser(username, groupId, channelId, { limit: 100 })
}

Deno.test('persona BeforeUserEdit then world MessageEdit rewrite before DAG edit', async () => {
	const { username, groupId, channelId } = await setupEditPathSession()
	const hooks = editPathHookState()
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	await postChannelMessage(username, groupId, channelId, { text: 'seed persona-edit-me world-edit-me' })
	const row = (await listMessages(username, groupId, channelId)).find(m =>
		String(m.content?.content || '').includes('persona-edit-me'))
	assert(row?.eventId)

	const { applyChannelMessageEditHooks } = await import('../../src/chat/channel/channelUserHooks.mjs')
	const { appendChannelMessageEdit, findChannelMessageRow } = await import('../../src/chat/channel/messageMutations.mjs')
	const originalRow = await findChannelMessageRow(username, groupId, channelId, row.eventId)
	const edited = await applyChannelMessageEditHooks(
		username, groupId, channelId, row.eventId, originalRow,
		{ type: 'text', content: 'edited persona-edit-me world-edit-me' },
	)
	await appendChannelMessageEdit(username, groupId, channelId, row.eventId, edited)

	assertEquals(hooks.beforeEditCalls.length, 1)
	assertEquals(hooks.worldEditCalls.length, 1)
	const messages = await listMessages(username, groupId, channelId)
	const hit = messages.find(m => String(m.content?.content || '').includes('world-edited'))
	assert(hit)
	assertStringIncludes(String(hit.content.content), 'persona-edited')
})

Deno.test('persona/world BeforeUserDelete and MessageDelete reject delete', async () => {
	const { username, groupId, channelId } = await setupEditPathSession()
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { applyChannelMessageDeleteHooks } = await import('../../src/chat/channel/channelUserHooks.mjs')
	const { findChannelMessageRow } = await import('../../src/chat/channel/messageMutations.mjs')

	await postChannelMessage(username, groupId, channelId, { text: 'keep persona-delete-reject' })
	const rejectRow = (await listMessages(username, groupId, channelId)).at(-1)
	assert(rejectRow?.eventId)
	const rowObj = await findChannelMessageRow(username, groupId, channelId, rejectRow.eventId)
	await assertRejects(
		() => applyChannelMessageDeleteHooks(username, groupId, channelId, rejectRow.eventId, rowObj),
		Error,
		'persona rejected delete',
	)

	await postChannelMessage(username, groupId, channelId, { text: 'world-delete-reject marker' })
	const worldRow = (await listMessages(username, groupId, channelId)).at(-1)
	const worldObj = await findChannelMessageRow(username, groupId, channelId, worldRow.eventId)
	await assertRejects(
		() => applyChannelMessageDeleteHooks(username, groupId, channelId, worldRow.eventId, worldObj),
		Error,
		'world rejected delete',
	)
})

Deno.test('world GetCharReply intercepts before char.GetReply', async () => {
	const { username, groupId, channelId } = await setupEditPathSession()
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')
	await addchar(groupId, CHAR, username)

	await triggerCharReply(groupId, channelId, CHAR)
	const start = Date.now()
	let messages = []
	while (Date.now() - start < 10000) {
		messages = await listMessages(username, groupId, channelId)
		if (messages.some(m => String(m.content?.content || '').includes('world-intercepted')))
			break
		await new Promise(r => setTimeout(r, 40))
	}
	assert(messages.some(m => String(m.content?.content || '').includes(`world-intercepted:${CHAR}`)))
})
