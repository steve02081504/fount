/* global Deno */
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

/**
 * @param {object} node 测试节点
 * @param {string} path API 路径
 * @param {object} [body] POST 载荷
 * @returns {Promise<{ status: number, data: object }>} 响应
 */
async function request(node, path, body) {
	const response = await fetch(`${node.baseUrl}${path}?fount-apikey=${encodeURIComponent(node.apiKey)}`, {
		method: body ? 'POST' : 'GET',
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: response.status, data: await response.json() }
}

Deno.test({ name: 'a fresh node starts a private chat with the node behind a copied contact link', sanitizeOps: false, sanitizeResources: false }, async () => {
	const nodes = []
	try {
		for (const username of ['inviter', 'invitee']) nodes.push(await launchNode({
			username, p2p: true, loadParts: username === 'inviter' ? ['shells/home', 'shells/chat'] : ['shells/home'],
			bootstrap: fileURLToPath(new URL('../node_bootstrap.mjs', import.meta.url)),
		}))
		const [inviter, invitee] = nodes
		const identity = (await request(inviter, '/api/p2p/federation')).data
		// 拷贝出来的页面链接带的是拷贝者自己的 origin；接受方只能从 entityHash 前缀解析邀请节点。
		const link = `http://localhost:8931/parts/shells:chat/hub/?contact=${identity.entityHash}`
		const result = await request(invitee, '/api/parts/shells:home/invitation', { link })
		assertEquals(result.status, 200, JSON.stringify(result.data))
		assertEquals(result.data.pending, true)
		assertEquals(result.data.nodeHash, identity.nodeHash)
	}
	finally {
		for (const node of nodes.reverse()) await stopNode(node)
	}
})
