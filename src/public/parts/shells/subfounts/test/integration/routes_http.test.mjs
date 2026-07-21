/**
 * Subfounts HTTP 路由集成测：连接码、本机分机列表、本机代码执行。
 */
/* global Deno */
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { subfountFetch } from './helpers/subfount_http.mjs'

/**
 * @returns {Promise<object>} 已启动的测试节点
 */
async function launchSubfountNode() {
	const apiKey = `fount-subfounts-http-${Date.now().toString(36)}`
	return await launchNode({
		username: 'subfounts-http-user',
		apiKey,
		loadParts: ['shells/subfounts'],
		p2p: false,
		minP2pNode: true,
	})
}

Deno.test({
	name: 'GET connection-code returns peerId and password',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchSubfountNode()
	try {
		const res = await subfountFetch(node, 'GET', '/connection-code')
		const raw = await res.text()
		assertEquals(res.status, 200, raw)
		const body = JSON.parse(raw)
		assert(body.peerId)
		assert(body.password)
		assert(String(body.peerId).startsWith('fountHost-'))
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'GET connected includes localhost host subfount',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchSubfountNode()
	try {
		await subfountFetch(node, 'GET', '/connection-code')
		const res = await subfountFetch(node, 'GET', '/connected')
		const raw = await res.text()
		assertEquals(res.status, 200, raw)
		const body = JSON.parse(raw)
		const host = (body.subfounts || []).find(s => s.id === 0)
		assert(host, 'host subfount missing')
		assertEquals(host.deviceId, 'localhost')
		assertEquals(host.isConnected, true)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'POST execute runs script on host subfount id 0',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchSubfountNode()
	try {
		const codeRes = await subfountFetch(node, 'GET', '/connection-code')
		assertEquals(codeRes.status, 200)
		const { peerId } = await codeRes.json()

		const res = await subfountFetch(node, 'POST', '/execute', {
			subfountId: 0,
			script: '1 + 1',
		})
		const raw = await res.text()
		assertEquals(res.status, 200, raw)
		const body = JSON.parse(raw)
		assertEquals(body.result?.result, 2)
		assertEquals(body.result?.outputEntries, [])

		const listRes = await subfountFetch(node, 'GET', '/list')
		assertEquals(listRes.status, 200)
		const listBody = await listRes.json()
		assert((listBody.subfounts || []).some(s => s.id === 0))

		const regenRes = await subfountFetch(node, 'POST', '/regenerate-code')
		assertEquals(regenRes.status, 200)
		const regenBody = await regenRes.json()
		assert(regenBody.peerId)
		assert(regenBody.password)
		assert(regenBody.peerId !== peerId, 'expected regenerated peerId to differ')
	}
	finally {
		await stopNode(node)
	}
})
