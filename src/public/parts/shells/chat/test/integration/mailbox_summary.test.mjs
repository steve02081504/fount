/**
 * mailbox/summary：经认证路由计数；activePubKeyHex 须先 hex→bytes 再 pubKeyHash。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { hexToBytes } from 'npm:@steve02081504/fount-p2p/core/bytes_codec'
import { pubKeyHash } from 'npm:@steve02081504/fount-p2p/crypto'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test({
	name: 'mailbox/summary HTTP counts pending for recipient pubKeyHash',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const username = `mbx-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { getFederationSettings } = await import('../../src/chat/federation/config.mjs')
	const { storeMailboxRecord } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
	const { CHAT_API_PREFIX } = await import('../../src/group/routes/path.mjs')
	const { registerMailboxRoutes } = await import('../../src/endpoints/mailbox.mjs')

	const fed = await getFederationSettings(username)
	const activePubKeyHex = String(fed?.activePubKeyHex || '').trim()
	assertEquals(activePubKeyHex.length > 0, true, 'operator activePubKeyHex required')

	// 回归：把 hex 字符串直接喂给 pubKeyHash 会炸（旧 mailbox.mjs 行为）
	assertThrows(() => pubKeyHash(activePubKeyHex), Error, 'Uint8Array-compatible')

	const toPubKeyHash = pubKeyHash(hexToBytes(activePubKeyHex))
	const stored = await storeMailboxRecord({
		app: 'chat',
		toPubKeyHash,
		tier: 'normal',
		hop: 0,
		envelope: { id: `mbx${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 32), type: 'message' },
		groupId: 'g-summary',
	})
	assertEquals(stored, true)

	/** @type {{ path: string, stack: Function[] }[]} */
	const routes = []
	registerMailboxRoutes({
		/**
		 * @param {string} path 路由路径
		 * @param {...Function} stack 中间件与处理器
		 * @returns {void} 无返回值
		 */
		get(path, ...stack) {
			routes.push({ path, stack })
		},
	})
	const route = routes.find(row => row.path === `${CHAT_API_PREFIX}/mailbox/summary`)
	assertEquals(!!route, true, 'mailbox/summary route registered')
	const handler = route.stack.at(-1)

	/** @type {{ statusCode: number, body: unknown }} */
	const result = { statusCode: 0, body: null }
	const req = { user: { username } }
	const res = {
		/**
		 * @param {number} code 状态码
		 * @returns {object} 链式 res
		 */
		status(code) {
			result.statusCode = code
			return this
		},
		/**
		 * @param {unknown} body JSON 体
		 * @returns {void} 无返回值
		 */
		json(body) {
			result.body = body
		},
	}
	await handler(req, res)
	assertEquals(result.statusCode, 200)
	assertEquals(result.body, { pendingCount: 1 })
})
