/**
 * mailbox/summary：activePubKeyHex 是 hex 字符串，pubKeyHash 需要字节。
 */
/* global Deno */
import { hexToBytes } from 'npm:@steve02081504/fount-p2p/core/bytes_codec'
import { pubKeyHash } from 'npm:@steve02081504/fount-p2p/crypto'
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test({
	name: 'mailbox summary recipient hash accepts hex activePubKey',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const username = `mbx-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { getFederationSettings } = await import('../../src/chat/federation/config.mjs')
	const { countMailboxPendingForRecipient } = await import('npm:@steve02081504/fount-p2p/mailbox/store')
	const fed = await getFederationSettings(username)
	const activePubKeyHex = String(fed?.activePubKeyHex || '').trim()
	assertEquals(activePubKeyHex.length > 0, true, 'operator activePubKeyHex required')

	// 回归：把 hex 字符串直接喂给 pubKeyHash 会炸（旧 mailbox.mjs 行为）
	assertThrows(() => pubKeyHash(activePubKeyHex), Error, 'Uint8Array-compatible')

	const pendingCount = await countMailboxPendingForRecipient(pubKeyHash(hexToBytes(activePubKeyHex)))
	assertEquals(typeof pendingCount, 'number')
})
