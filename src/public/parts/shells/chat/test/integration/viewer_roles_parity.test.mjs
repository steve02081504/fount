/**
 * A4：按 viewer.roles 过滤 chat_log（world GetChatLogForViewer）。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const WORLD = 'roles_filter'
const CHAR = 'viewer_agent'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedRolesFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	for (const [kind, name] of [
		['worlds', WORLD],
		['chars', CHAR],
	]) {
		const from = join(fixturesRoot, kind, name)
		const to = join(userRoot, kind, name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

Deno.test('GetChatLogForViewer hides staff-only when viewer lacks moderator role', async () => {
	const username = `roles-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_viewer_roles_',
		minP2pNode: true,
		/**
		 * 种子 fixture 前确保 operator 公钥就绪。
		 * @param {string} user replica 登录名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedRolesFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { bindWorld, addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { readViewerChannelMessages } = await import('../../src/chat/session/materializeViewerLog.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')

	const groupId = await newGroup(username, { name: 'roles-filter' })
	const channelId = await getDefaultChannelId(username, groupId)
	await bindWorld(groupId, channelId, WORLD, username)
	await addchar(groupId, CHAR, username)

	await postChannelMessage(username, groupId, channelId, { text: 'public hello' })
	await postChannelMessage(username, groupId, channelId, { text: 'staff-only secret marker' })

	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { resolveActiveAgentMemberKeyByCharname } = await import('../../src/group/access.mjs')
	const { state } = await getState(username, groupId)
	const memberKey = resolveActiveAgentMemberKeyByCharname(state, CHAR)
	assert(memberKey)

	await appendSignedLocalEvent(username, groupId, {
		type: 'role_create',
		timestamp: Date.now(),
		content: {
			roleId: 'moderator',
			name: 'Moderator',
			color: '#3498db',
			position: 50,
			permissions: { VIEW_CHANNEL: true, SEND_MESSAGES: true },
			isDefault: false,
			isHoisted: false,
		},
	})
	await appendSignedLocalEvent(username, groupId, {
		type: 'role_assign',
		timestamp: Date.now(),
		content: { targetMemberKey: memberKey, roleId: 'moderator' },
	})

	const request = await getChatRequest(groupId, CHAR, channelId, { replicaUsername: username })
	assert(request.member_roles.includes('moderator'))
	const agentTexts = (request.chat_log || []).map(entry => String(entry.content || ''))
	assert(agentTexts.some(text => text.includes('public hello')))
	assert(agentTexts.some(text => text.includes('staff-only secret marker')))

	const { messages } = await readViewerChannelMessages(username, groupId, channelId, { limit: 20 })
	const humanTexts = messages
		.filter(row => row.type === 'message')
		.map(row => String(row.content?.content || ''))
	assert(humanTexts.some(text => text.includes('public hello')))
	assert(!humanTexts.some(text => text.includes('staff-only secret marker')))

	// entry.visibility ACL：base 层与 prompt_struct 同规则——无角色 human 的 view-log 隐藏、raw 可见、有角色 char 可见
	const ACL_MARKER = 'visibility-acl secret'
	await appendSignedLocalEvent(username, groupId, {
		type: 'message',
		channelId,
		timestamp: Date.now(),
		content: { type: 'text', content: ACL_MARKER, visibility: { roles: ['moderator'] } },
	})

	const { messages: humanAfterAcl } = await readViewerChannelMessages(username, groupId, channelId, { limit: 20 })
	assert(!humanAfterAcl.some(row => String(row.content?.content || '').includes(ACL_MARKER)))

	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const rawLines = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	assert(rawLines.some(row => String(row.content?.content || '').includes(ACL_MARKER)))

	const { messages: charViewLog } = await readViewerChannelMessages(
		username, groupId, channelId, { limit: 20 }, { kind: 'char', charname: CHAR },
	)
	assert(charViewLog.some(row => String(row.content?.content || '').includes(ACL_MARKER)))
})
