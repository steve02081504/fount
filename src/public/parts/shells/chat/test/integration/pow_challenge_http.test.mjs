/**
 * pow-challenge HTTP 集成测：本地 replica 场景 —— `/pow-challenge` 返回当前锚、
 * invite-ticket 不再输出 powAnchorRef、createInvite URL 不再携带 powAnchorRef。
 */
/* global Deno */
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const bootstrapPath = join(testDir, 'pow_challenge_bootstrap.mjs')
const CHAT_PREFIX = '/api/parts/shells:chat'

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

/**
 * @returns {Promise<{ node: object, setup: object }>} 已启动节点与 bootstrap 写入的 setup
 */
async function launchPowScenario() {
	const dataPath = await mkdtemp(join(tmpdir(), `fount_chat_pow_challenge_`))
	const apiKey = `fount-chat-pow-challenge-${Date.now().toString(36)}`
	const node = await launchNode({
		dataPath,
		username: 'pow-challenge',
		apiKey,
		loadParts: ['shells/chat'],
		bootstrap: bootstrapPath,
		minP2pNode: true,
		p2p: false,
		extraEnv: {
			FOUNT_TEST_DATA_PATH: dataPath,
		},
	})
	const setupRaw = await readFile(join(dataPath, 'pow_challenge_setup.json'), 'utf8')
	return { node, setup: JSON.parse(setupRaw) }
}

Deno.test({
	name: 'pow-challenge returns stable anchors for local pow replica',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { node, setup } = await launchPowScenario()
	try {
		const res = await chatFetch(node, 'GET', `/groups/${setup.groupId}/pow-challenge`)
		assertEquals(res.status, 200)
		const body = await res.json()
		assertEquals(body.joinPolicy, 'pow')
		assert(Array.isArray(body.anchors) && body.anchors.length > 0, 'anchors non-empty')
		assert(typeof body.powFloorBits === 'number' && body.powFloorBits > 0, 'powFloorBits present')
	} finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'invite-ticket response omits powAnchorRef; createInvite URL carries no anchor',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { node, setup } = await launchPowScenario()
	try {
		const ticketRes = await chatFetch(node, 'POST', `/groups/${setup.groupId}/invite-ticket`, { ttlMs: 3_600_000 })
		assertEquals(ticketRes.status, 201)
		const ticket = await ticketRes.json()
		assertEquals(ticket.powAnchorRef, undefined, 'no powAnchorRef in invite-ticket response')
		assertEquals(ticket.powAnchors, undefined, 'no powAnchors in invite-ticket response')

		// createInvite URL：parse 出的 join payload 不得含 powAnchorRef。
		const url = setup.inviteUrl
		const protocolUrl = new URL(url)
		const runUri = decodeURIComponent(protocolUrl.searchParams.get('url') || '')
		const segments = runUri.split(';').map(segment => decodeURIComponent(segment))
		const payload = JSON.parse(segments[segments.length - 1])
		assertEquals(payload.powAnchorRef, undefined, 'createInvite URL omits powAnchorRef')
		assert(payload.groupId === setup.groupId, 'group id present')
		assert(payload.roomSecret, 'roomSecret present for federation bootstrap')
	} finally {
		await stopNode(node)
	}
})
