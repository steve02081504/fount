/**
 * 用仅含 charname 的 friendBinding 建好友群：后端物化 agent（未聊过的本地角色）。
 */
/* global Deno */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'jsr:@std/assert'

const testDir = dirname(fileURLToPath(import.meta.url))
const fixturesRoot = join(testDir, '../fixtures')
const CHAT_PREFIX = '/api/parts/shells:chat'
const CHAR = 'on_message_yes'

/**
 * @param {object} node launchNode 句柄
 * @param {string} method HTTP 方法
 * @param {string} path 相对 chat API 路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>} fetch 响应
 */
function chatFetch(node, method, path, body) {
	const sep = path.includes('?') ? '&' : '?'
	const url = `${node.baseUrl}${CHAT_PREFIX}${path}${sep}fount-apikey=${encodeURIComponent(node.apiKey)}`
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
			{ from: join(fixturesRoot, 'chars', CHAR), to: `chars/${CHAR}` },
		],
	})
	try {
		const viewerRes = await chatFetch(node, 'GET', '/viewer')
		assertEquals(viewerRes.status, 200)
		const viewer = await viewerRes.json()
		assert(viewer.viewerEntityHash, 'operator identity required')
		assertEquals(
			(viewer.agents || []).some(row => row.charPartName === CHAR),
			false,
			'fresh char must not appear in viewer.agents before friend group create',
		)

		const createRes = await chatFetch(node, 'POST', '/groups/', {
			name: CHAR,
			friendBinding: { charname: CHAR },
		})
		const created = await createRes.json().catch(() => ({}))
		assertEquals(createRes.status, 201, JSON.stringify(created))
		assert(created.groupId)
		assertEquals(created.friendBinding?.charname, CHAR)
		assert(typeof created.friendBinding?.entityHash === 'string'
			&& created.friendBinding.entityHash.length === 128)

		const viewerAfter = await (await chatFetch(node, 'GET', '/viewer')).json()
		assert(
			(viewerAfter.agents || []).some(row =>
				row.charPartName === CHAR
				&& row.entityHash === created.friendBinding.entityHash),
			'viewer.agents must include agent materialized by friend group create',
		)

		const addCharRes = await chatFetch(node, 'POST', `/groups/${created.groupId}/char`, {
			charname: CHAR,
			deferGreeting: true,
		})
		const addCharBody = await addCharRes.json().catch(() => ({}))
		assertEquals(addCharRes.status, 200, JSON.stringify(addCharBody))
	}
	finally {
		await stopNode(node)
	}
})
