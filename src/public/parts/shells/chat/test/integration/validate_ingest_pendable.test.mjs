/**
 * validateIngestAuthz：暂时性失败应标记 pendable（pending_ingest），硬拒绝不带 pendable。
 */
/* global Deno */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { validateIngestAuthz } from '../../src/chat/dag/ingest.mjs'
import { eventsPath } from '../../src/chat/lib/paths.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const SENDER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const TIP_A = 'c'.repeat(64)
const TIP_B = 'd'.repeat(64)
const TIP_C = 'e'.repeat(64)

const { ensureServer, username } = createIntegrationBoot({
	username: 'ingest-pendable-user',
	loadParts: [],
})

/**
 * @returns {object} 无活跃成员的物化状态
 */
function emptyAclState() {
	return {
		members: {},
		roles: {},
		channels: {},
		channelPermissions: {},
		groupSettings: {},
	}
}

/**
 * @returns {object} 含活跃成员的最小物化状态
 */
function activeMemberState() {
	return {
		members: {
			[SENDER]: { status: 'active', roles: ['@everyone'] },
		},
		roles: {
			'@everyone': { permissions: { SEND_MESSAGES: true } },
		},
		channels: { default: {} },
		channelPermissions: {},
		groupSettings: {},
	}
}

Deno.test('federation member_ban without ACL snapshot is pendable', async () => {
	const event = {
		type: 'member_ban',
		sender: SENDER,
		content: { targetMemberKey: OTHER, banScope: 'entity' },
	}
	let thrown
	try {
		await validateIngestAuthz('user', 'gid', event, { source: 'federation', state: emptyAclState() })
	}
	catch (error) { thrown = error }
	assertEquals(thrown?.pendable, true)
	assertEquals(String(thrown?.message).includes('no ACL snapshot'), true)
})

Deno.test('federation message without SEND_MESSAGES is not pendable', async () => {
	const state = {
		members: { [SENDER]: { status: 'active', roles: ['@everyone'] } },
		roles: { '@everyone': { permissions: {} } },
		channels: { default: {} },
		channelPermissions: {},
		groupSettings: {},
	}
	const event = {
		type: 'message',
		sender: SENDER,
		channelId: 'default',
		content: { type: 'text', content: 'hi' },
	}
	let thrown
	try {
		await validateIngestAuthz('user', 'gid', event, { source: 'federation', state })
	}
	catch (error) { thrown = error }
	assertEquals(thrown?.pendable, undefined)
})

Deno.test('dag_tip_merge with fewer than 2 prev is a hard reject (not pendable)', async () => {
	await ensureServer()
	const groupId = 'g-merge-one-prev'
	const path = eventsPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify({
		id: TIP_A,
		type: 'message',
		prev_event_ids: [],
		sender: SENDER,
	})}\n`, 'utf8')

	const event = {
		type: 'dag_tip_merge',
		sender: SENDER,
		prev_event_ids: [TIP_A],
	}
	let thrown
	try {
		await validateIngestAuthz(username, groupId, event, { source: 'federation', state: activeMemberState() })
	}
	catch (error) { thrown = error }
	assertEquals(thrown?.pendable, undefined)
	assertEquals(thrown?.message, 'dag_tip_merge: must reference >= 2 prev tips')
})

Deno.test('dag_tip_merge with a missing prev event is pendable', async () => {
	await ensureServer()
	const groupId = 'g-merge-missing-prev'
	const path = eventsPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	// 本地只有 TIP_A；合并引用 TIP_A + TIP_B，TIP_B 尚未到达 → 可延迟等 catchup 补齐后重放。
	await writeFile(path, `${JSON.stringify({ id: TIP_A, type: 'message', prev_event_ids: [], sender: SENDER })}\n`, 'utf8')

	const event = {
		type: 'dag_tip_merge',
		sender: SENDER,
		prev_event_ids: [TIP_A, TIP_B],
	}
	let thrown
	try {
		await validateIngestAuthz(username, groupId, event, { source: 'federation', state: activeMemberState() })
	}
	catch (error) { thrown = error }
	assertEquals(thrown?.pendable, true)
	assertEquals(thrown?.message, 'dag_tip_merge: prev events not present yet')
})

Deno.test('dag_tip_merge is accepted when all prev present, even with extra local tips', async () => {
	await ensureServer()
	const groupId = 'g-merge-extra-tips'
	const path = eventsPath(username, groupId)
	await mkdir(dirname(path), { recursive: true })
	// 本地 frontier = {TIP_A, TIP_B, TIP_C}（三叶）；远端合并仅汇合 {TIP_A, TIP_B}。
	// 跨节点并发合并下，接收方 frontier 与对方 merge 的 prev 不会一致；只要父事件齐备就应入站，
	// 多余的本地 tip 留待后续合并收敛（不再因 frontier 不匹配而永久互锁）。
	const rows = [
		{ id: TIP_A, type: 'message', prev_event_ids: [], sender: SENDER },
		{ id: TIP_B, type: 'message', prev_event_ids: [], sender: SENDER },
		{ id: TIP_C, type: 'message', prev_event_ids: [], sender: SENDER },
	]
	await writeFile(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8')

	const event = {
		type: 'dag_tip_merge',
		sender: SENDER,
		prev_event_ids: [TIP_A, TIP_B],
	}
	let thrown
	try {
		await validateIngestAuthz(username, groupId, event, { source: 'federation', state: activeMemberState() })
	}
	catch (error) { thrown = error }
	assertEquals(thrown, undefined)
})
