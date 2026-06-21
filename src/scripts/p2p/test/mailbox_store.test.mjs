/* global Deno */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	deleteMailboxRecords,
	getMailboxRecords,
	mailboxTierFromHop,
	normalizeMailboxHop,
	storeMailboxRecord,
} from '../mailbox/store.mjs'
import { initNode } from '../node/instance.mjs'

const RECIPIENT = 'a'.repeat(64)
const FROM_NODE = 'b'.repeat(64)

/**
 * @param {(dir: string) => Promise<void>} testFn 测试函数
 * @returns {Promise<void>}
 */
async function withTempNodeDir(testFn) {
	const dir = await mkdtemp(join(tmpdir(), 'fount-mailbox-'))
	initNode({ nodeDir: dir })
	await mkdir(join(dir, 'mailbox'), { recursive: true })
	try {
		await testFn(dir)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
}

Deno.test('normalizeMailboxHop clamps negatives and non-integers', () => {
	assertEquals(normalizeMailboxHop(-1), 0)
	assertEquals(normalizeMailboxHop(-99), 0)
	assertEquals(normalizeMailboxHop(1.9), 1)
	assertEquals(normalizeMailboxHop('abc'), 0)
	assertEquals(normalizeMailboxHop(Number.NaN), 0)
})

Deno.test('negative hop normalized relay becomes hop 1 not trusted hop 0', () => {
	const inbound = normalizeMailboxHop(-1)
	assertEquals(inbound, 0)
	assertEquals(inbound + 1, 1)
	assertEquals(mailboxTierFromHop(inbound + 1), 'normal')
})

Deno.test('storeMailboxRecord accepts quarantine tier at hop >= 2', async () => {
	await withTempNodeDir(async () => {
		const stored = await storeMailboxRecord({
			app: 'chat',
			toPubKeyHash: RECIPIENT,
			envelope: { id: 'env-quarantine' },
			hop: 2,
			tier: 'quarantine',
			fromNodeHash: FROM_NODE,
		})
		assertEquals(stored, true)
		const rows = await getMailboxRecords(['env-quarantine'])
		assertEquals(rows.length, 1)
		assertEquals(rows[0].tier, 'quarantine')
		assertEquals(rows[0].hop, 2)
	})
})

Deno.test('storeMailboxRecord concurrent writes keep both records', async () => {
	await withTempNodeDir(async () => {
		const results = await Promise.all([
			storeMailboxRecord({
				app: 'chat',
				toPubKeyHash: RECIPIENT,
				envelope: { id: 'env-a' },
				hop: 0,
				tier: 'trusted',
				fromNodeHash: FROM_NODE,
			}),
			storeMailboxRecord({
				app: 'chat',
				toPubKeyHash: RECIPIENT,
				envelope: { id: 'env-b' },
				hop: 1,
				tier: 'normal',
				fromNodeHash: FROM_NODE,
			}),
		])
		assertEquals(results, [true, true])
		const rows = await getMailboxRecords(['env-a', 'env-b'])
		assertEquals(rows.length, 2)
	})
})

Deno.test('deleteMailboxRecords removes by envelope id', async () => {
	await withTempNodeDir(async () => {
		await storeMailboxRecord({
			app: 'chat',
			toPubKeyHash: RECIPIENT,
			envelope: { id: 'env-del' },
			hop: 0,
			tier: 'trusted',
			fromNodeHash: FROM_NODE,
		})
		await deleteMailboxRecords(['env-del'])
		assertEquals((await getMailboxRecords(['env-del'])).length, 0)
	})
})
