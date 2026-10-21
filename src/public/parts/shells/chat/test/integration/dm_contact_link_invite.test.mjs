/**
 * 私聊链接建群必须把对端拉进来：只在本机建 ECDH DM 群时，对端节点既不知道这个会话，
 * 也永远收不到里面的消息（好友列表里什么都没有）。
 */
/* global Deno */
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'jsr:@std/assert'

import { waitUntil } from 'fount/scripts/test/core/wait.mjs'
import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'

/**
 * @param {object} node 测试节点
 * @param {string} path API 路径
 * @param {object} [body] POST 载荷
 * @returns {Promise<{ status: number, data: object }>} 响应
 */
async function request(node, path, body) {
	const url = new URL(path, node.baseUrl)
	url.searchParams.set('fount-apikey', node.apiKey)
	const response = await fetch(url, {
		method: body ? 'POST' : 'GET',
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: response.status, data: await response.json() }
}

Deno.test({
	name: 'a DM started from a shared contact link invites the peer node and shows up in its friends list',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	/** @type {object[]} */
	const nodes = []
	try {
		const bootstrap = fileURLToPath(new URL('../node_bootstrap.mjs', import.meta.url))
		for (const username of ['dm-link-owner', 'dm-link-opener'])
			nodes.push(await launchNode({ username, p2p: true, loadParts: ['shells/chat'], bootstrap }))
		const [owner, opener] = nodes
		const ownerView = (await request(owner, '/api/p2p/federation')).data
		const openerView = (await request(opener, '/api/p2p/federation')).data

		// 打开链接的一方此前刚读过链接主人的资料（EVFS 联邦读取顺带建链）；这里直接建链。
		const connected = await request(opener, '/api/p2p/federation/connect-node', { targetNodeHash: ownerView.nodeHash })
		assertEquals(connected.data.connected, true, JSON.stringify(connected.data))

		// 与 Hub 的 `?contact=<entityHash>` 落地一致：建 ECDH DM 群，并把链接主人作为好友绑定交给服务端。
		const created = await request(opener, '/api/parts/shells:chat/groups/', {
			template: 'dm',
			myPubKeyHex: openerView.activePubKeyHex,
			peerPubKeyHex: ownerView.activePubKeyHex,
			friendBinding: { entityHash: ownerView.entityHash },
		})
		assertEquals(created.status, 201, JSON.stringify(created.data))
		const groupId = created.data.groupId
		assertEquals(created.data.friendBinding?.entityHash, ownerView.entityHash, 'the opener keeps the link owner as its friend')

		// 链接主人侧：邀请送达后入群，好友列表里出现的是发起者，而不是指向自己的空行。
		await waitUntil(async () => {
			const { data } = await request(owner, '/api/parts/shells:chat/groups/')
			return Array.isArray(data) && data.some(row => row.groupId === groupId && row.memberCount === 2)
		}, 120_000, 2000)
		const ownerRows = (await request(owner, '/api/parts/shells:chat/groups/')).data
		const ownerRow = ownerRows.find(row => row.groupId === groupId)
		assertEquals(ownerRow.friendBinding?.entityHash, openerView.entityHash,
			`invited side must list the initiator, got ${JSON.stringify(ownerRow)}`)

		// 开场私聊消息要能到对端：这正是用户报告「发了消息但我这边什么都没有」的那一步。
		const sent = await request(opener, `/api/parts/shells:chat/groups/${groupId}/channels/default/messages`, {
			content: { content: 'hello from the contact link' },
		})
		assertEquals(sent.status, 201, JSON.stringify(sent.data))
		await waitUntil(async () => {
			const { data } = await request(owner, `/api/parts/shells:chat/groups/${groupId}/channels/default/view-log`)
			return (data.messages || []).some(message => message.content?.content === 'hello from the contact link')
		}, 120_000, 2000)
	}
	finally {
		for (const node of nodes.reverse()) await stopNode(node)
	}
})
