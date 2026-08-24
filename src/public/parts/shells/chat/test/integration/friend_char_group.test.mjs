/**
 * 用仅含 charname 的 friendBinding 建好友群：后端物化 agent（未聊过的本地角色）。
 */
/* global Deno */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const fixturesRoot = join(testDir, '../fixtures')
const CHAT_PREFIX = '/api/parts/shells:chat'
const characterName = 'on_message_yes'

/**
 * @param {object} node launchNode 句柄
 * @param {string} method HTTP 方法
 * @param {string} path 相对 chat API 路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>} fetch 响应
 */
function chatFetch(node, method, path, body) {
	const url = `${node.baseUrl}${CHAT_PREFIX}${path}${path.includes('?') ? '&' : '?'}fount-apikey=${encodeURIComponent(node.apiKey)}`
	return fetch(url, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
}

Deno.test({
	name: 'POST /groups with charname-only friendBinding materializes local agent',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const dataPath = await mkdtemp(join(tmpdir(), 'fount_chat_friend_char_'))
	const apiKey = `fount-friend-char-${Date.now().toString(36)}`
	const node = await launchNode({
		dataPath,
		username: 'friend-char',
		apiKey,
		loadParts: ['shells/chat'],
		minP2pNode: true,
		p2p: false,
		fixtureCopies: [
			{ from: join(fixturesRoot, 'chars', characterName), to: `chars/${characterName}` },
		],
	})
	try {
		const viewerResponse = await chatFetch(node, 'GET', '/viewer')
		assertEquals(viewerResponse.status, 200)
		const viewer = await viewerResponse.json()
		assert(viewer.viewerEntityHash, 'operator identity required')
		assertEquals(
			(viewer.agents || []).some(row => row.charPartName === characterName),
			false,
			'fresh char must not appear in viewer.agents before friend group create',
		)

		const createResponse = await chatFetch(node, 'POST', '/groups/', {
			name: characterName,
			friendBinding: { charname: characterName },
		})
		const created = await createResponse.json().catch(() => ({}))
		assertEquals(createResponse.status, 201, JSON.stringify(created))
		assert(created.groupId)
		assertEquals(created.friendBinding?.charname, characterName)
		assert(typeof created.friendBinding?.entityHash === 'string'
			&& created.friendBinding.entityHash.length === 128)

		const viewerAfter = await (await chatFetch(node, 'GET', '/viewer')).json()
		assert(
			(viewerAfter.agents || []).some(row =>
				row.charPartName === characterName
				&& row.entityHash === created.friendBinding.entityHash),
			'viewer.agents must include agent materialized by friend group create',
		)

		const addCharResponse = await chatFetch(node, 'POST', `/groups/${created.groupId}/char`, {
			charname: characterName,
			deferGreeting: true,
		})
		const addCharBody = await addCharResponse.json().catch(() => ({}))
		assertEquals(addCharResponse.status, 200, JSON.stringify(addCharBody))

		const reuseResponse = await chatFetch(node, 'POST', '/groups/', {
			name: `${characterName}-reuse`,
			friendBinding: {
				charname: characterName.toUpperCase(),
				entityHash: 'f'.repeat(128),
			},
		})
		const reused = await reuseResponse.json().catch(() => ({}))
		assertEquals(reuseResponse.status, 200, JSON.stringify(reused))
		assertEquals(reused.reused, true)
		assertEquals(reused.groupId, created.groupId)
		assertEquals(reused.friendBinding?.charname, characterName)
		assertEquals(reused.friendBinding?.entityHash, created.friendBinding.entityHash)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'PUT /groups/:id/meta with entityHash-only friendBinding fills local charname',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const dataPath = await mkdtemp(join(tmpdir(), 'fount_chat_friend_meta_'))
	const apiKey = `fount-friend-meta-${Date.now().toString(36)}`
	const node = await launchNode({
		dataPath,
		username: 'friend-meta',
		apiKey,
		loadParts: ['shells/chat'],
		minP2pNode: true,
		p2p: false,
		fixtureCopies: [
			{ from: join(fixturesRoot, 'chars', characterName), to: `chars/${characterName}` },
		],
	})
	try {
		const createResponse = await chatFetch(node, 'POST', '/groups/', {
			name: characterName,
			friendBinding: { charname: characterName },
		})
		const created = await createResponse.json().catch(() => ({}))
		assertEquals(createResponse.status, 201, JSON.stringify(created))
		const entityHash = created.friendBinding?.entityHash
		assert(typeof entityHash === 'string' && entityHash.length === 128)

		const clearResponse = await chatFetch(node, 'PUT', `/groups/${created.groupId}/meta`, {
			friendBinding: null,
		})
		assertEquals(clearResponse.status, 200, await clearResponse.text())

		const putResponse = await chatFetch(node, 'PUT', `/groups/${created.groupId}/meta`, {
			friendBinding: { entityHash },
		})
		const putBody = await putResponse.json().catch(() => ({}))
		assertEquals(putResponse.status, 200, JSON.stringify(putBody))
		assertEquals(putBody.friendBinding?.entityHash, entityHash)
		assertEquals(putBody.friendBinding?.charname, characterName)

		const listResponse = await chatFetch(node, 'GET', '/groups/')
		assertEquals(listResponse.status, 200)
		const rows = await listResponse.json()
		const row = rows.find(entry => entry.groupId === created.groupId)
		assert(row, 'created group must appear in list')
		assertEquals(row.friendBinding?.entityHash, entityHash)
		assertEquals(row.friendBinding?.charname, characterName)
	}
	finally {
		await stopNode(node)
	}
})
