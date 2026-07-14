/**
 * viewer 对称：GetChatLogForViewer / legacy GetChatLogForCharname 在 agent getChatRequest 路径生效。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'viewer_agent'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @param {string} worldname 世界 fixture 目录名
 * @returns {Promise<void>}
 */
async function seedViewerFixtures(dataDir, username, worldname) {
	const userRoot = join(dataDir, 'users', username)
	const copies = [
		{ from: join(fixturesRoot, 'chars', CHAR), to: join(userRoot, 'chars', CHAR) },
		{ from: join(fixturesRoot, 'worlds', worldname), to: join(userRoot, 'worlds', worldname) },
	]
	for (const { from, to } of copies) {
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * @param {string} worldname 世界名
 * @returns {Promise<{ username: string, groupId: string, channelId: string, request: object, state: object }>} 请求与群状态
 */
async function buildAgentRequestWithWorld(worldname) {
	const { ensureServer, username, dataDir } = createIntegrationBoot({
		username: `viewer-${worldname}`,
		tempDirPrefix: `fount_viewer_${worldname}_`,
		minP2pNode: true,
		/**
		 * @param {string} user 登录用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedViewerFixtures(dataDir, user, worldname)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar, bindWorld } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')

	const groupId = await newGroup(username, { name: `viewer-${worldname}` })
	const channelId = await getDefaultChannelId(username, groupId)
	await bindWorld(groupId, channelId, worldname, username)
	await addchar(groupId, CHAR, username)
	await postChannelMessage(username, groupId, channelId, {
		text: 'hello visible',
	})
	await postChannelMessage(username, groupId, channelId, {
		text: 'secret hidden-marker payload',
	})

	const request = await getChatRequest(groupId, CHAR, channelId, { replicaUsername: username })
	const { state } = await getState(username, groupId)
	return { username, groupId, channelId, request, state }
}

Deno.test('GetChatLogForViewer hides marked message on agent getChatRequest', async () => {
	const { request, state } = await buildAgentRequestWithWorld('viewer_filter')
	assert(request.member_roles.includes('@everyone'), 'agent roles injected')
	assertEquals(request.extension.member_roles, request.member_roles)
	const worldBound = state.session?.world?.worldname === 'viewer_filter'
		|| Object.values(state.session?.channelWorlds || {}).some(bind => bind?.worldname === 'viewer_filter')
	assert(worldBound, 'world bound')
	const contents = (request.chat_log || []).map(entry => String(entry.content || ''))
	assert(contents.some(text => text.includes('hello visible')), 'visible message kept')
	assert(!contents.some(text => text.includes('hidden-marker')), 'viewer filter hid marked message')
})

Deno.test('legacy GetChatLogForCharname still filters on agent getChatRequest', async () => {
	const { request } = await buildAgentRequestWithWorld('legacy_charname')
	const contents = (request.chat_log || []).map(entry => String(entry.content || ''))
	assert(contents.some(text => text.includes('hello visible')), 'visible message kept')
	assert(!contents.some(text => text.includes('hidden-marker')), 'legacy charname filter hid marked message')
})
