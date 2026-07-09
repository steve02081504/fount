/**
 * Chat HTTP 路由级集成测：view-log / BeforeUserSend 4xx / edit-delete 钩子链。
 */
/* global Deno */
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNode, pickAvailablePort, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const testDir = dirname(fileURLToPath(import.meta.url))
const fixturesRoot = join(testDir, '../fixtures')
const bootstrapPath = join(testDir, 'routes_http_bootstrap.mjs')
const CHAT_PREFIX = '/api/parts/shells:chat'

/**
 * @param {object} node launchNode 句柄
 * @param {string} method HTTP 方法
 * @param {string} path 相对 chat API 路径
 * @param {object} [body] JSON body
 * @returns {Promise<Response>}
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
 * @param {string} scenario bootstrap 场景名
 * @param {object[]} fixtureCopies launchNode fixtureCopies
 * @returns {Promise<{ node: object, setup: object }>}
 */
async function launchScenario(scenario, fixtureCopies) {
	const port = await pickAvailablePort(29331)
	const dataPath = await mkdtemp(join(tmpdir(), `fount_chat_http_${scenario}_`))
	const apiKey = `fount-chat-http-${scenario}-${port}`
	const node = await launchNode({
		port,
		dataPath,
		username: `http-${scenario}`,
		apiKey,
		loadParts: ['shells/chat'],
		bootstrap: bootstrapPath,
		minP2pNode: true,
		p2p: false,
		fixtureCopies,
		extraEnv: {
			FOUNT_TEST_DATA_PATH: dataPath,
			FOUNT_TEST_HTTP_SCENARIO: scenario,
		},
	})
	const setupRaw = await readFile(join(dataPath, 'routes_http_setup.json'), 'utf8')
	return { node, setup: JSON.parse(setupRaw) }
}

/**
 * @param {object[]} rows 消息行
 * @returns {string[]} 展示正文
 */
function messageTexts(rows) {
	return (rows || [])
		.filter(row => row.type === 'message')
		.map(row => String(row.content?.content_for_show ?? row.content?.content ?? ''))
}

Deno.test({
	name: 'GET view-log filters world/persona at HTTP layer',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { node, setup } = await launchScenario('viewlog', [
		{ from: join(fixturesRoot, 'worlds/human_viewer'), to: 'worlds/human_viewer' },
		{ from: join(fixturesRoot, 'personas/viewer_persona'), to: 'personas/viewer_persona' },
	])
	try {
		const rawRes = await chatFetch(node, 'GET', `/groups/${setup.groupId}/channels/${setup.channelId}/messages?limit=50`)
		assertEquals(rawRes.status, 200)
		const rawBody = await rawRes.json()
		const rawTexts = messageTexts(rawBody.messages)
		assert(rawTexts.some(text => text.includes('hidden-marker')), 'raw keeps hidden')

		const viewRes = await chatFetch(node, 'GET', `/groups/${setup.groupId}/channels/${setup.channelId}/view-log?limit=50`)
		assertEquals(viewRes.status, 200)
		const viewBody = await viewRes.json()
		const viewTexts = messageTexts(viewBody.messages)
		assert(viewTexts.some(text => text.includes('hello visible')))
		assert(!viewTexts.some(text => text.includes('hidden-marker')))
		assert(!viewTexts.some(text => text.includes('persona-hide-me')))
		assert(typeof viewBody.hasMore === 'boolean')

		if (setup.oldestEventId) {
			const pageRes = await chatFetch(
				node,
				'GET',
				`/groups/${setup.groupId}/channels/${setup.channelId}/view-log?before=${encodeURIComponent(setup.oldestEventId)}&limit=2`,
			)
			assertEquals(pageRes.status, 200)
			const pageBody = await pageRes.json()
			assert(Array.isArray(pageBody.messages))
			assert(typeof pageBody.hasMore === 'boolean')
		}
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'POST messages BeforeUserSend reject returns HTTP 400',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { node, setup } = await launchScenario('before_send_reject', [
		{ from: join(fixturesRoot, 'personas/write_path_persona'), to: 'personas/write_path_persona' },
	])
	try {
		const res = await chatFetch(node, 'POST', `/groups/${setup.groupId}/channels/${setup.channelId}/messages`, {
			content: { type: 'text', content: 'please persona-reject-me' },
		})
		assertEquals(res.status, 400)
		const body = await res.text()
		assert(body.includes('persona rejected send'))
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'PUT/DELETE messages run persona/world hooks over HTTP',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { node, setup } = await launchScenario('edit_hooks', [
		{ from: join(fixturesRoot, 'worlds/edit_path_world'), to: 'worlds/edit_path_world' },
		{ from: join(fixturesRoot, 'personas/edit_path_persona'), to: 'personas/edit_path_persona' },
	])
	try {
		assert(setup.editEventId)
		assert(setup.deleteRejectEventId)

		const editRes = await chatFetch(
			node,
			'PUT',
			`/groups/${setup.groupId}/channels/${setup.channelId}/messages/${setup.editEventId}`,
			{ content: { type: 'text', content: 'edited persona-edit-me world-edit-me' } },
		)
		assertEquals(editRes.status, 200)

		const listRes = await chatFetch(node, 'GET', `/groups/${setup.groupId}/channels/${setup.channelId}/messages?limit=50`)
		const listBody = await listRes.json()
		const edited = messageTexts(listBody.messages).find(text => text.includes('world-edited'))
		assert(edited)
		assert(String(edited).includes('persona-edited'))

		const deleteRes = await chatFetch(
			node,
			'DELETE',
			`/groups/${setup.groupId}/channels/${setup.channelId}/messages/${setup.deleteRejectEventId}`,
		)
		assertEquals(deleteRes.status, 400)
		const deleteBody = await deleteRes.text()
		assert(deleteBody.includes('persona rejected delete'))
	}
	finally {
		await stopNode(node)
	}
})
