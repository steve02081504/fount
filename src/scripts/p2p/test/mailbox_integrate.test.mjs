/* global Deno */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	dispatchMailboxRecordsToConsumers,
	registerMailboxConsumer,
	unregisterMailboxConsumer,
} from '../mailbox/consumer_registry.mjs'
import {
	ingestMailboxPut,
	publishMailboxRecord,
	respondMailboxWant,
} from '../mailbox/deliver_or_store.mjs'
import {
	getMailboxRecords,
	isDeliverableMailboxRecord,
	storeMailboxRecord,
} from '../mailbox/store.mjs'
import { ensureNodeDefaults } from '../node/identity.mjs'
import { initNode } from '../node/instance.mjs'

const RECIPIENT = 'a'.repeat(64)
const FROM_NODE = 'b'.repeat(64)
const USER = 'mailbox-integrate-user'

/**
 * 在临时节点目录执行测试。
 * @param {(dir: string) => Promise<void>} testFn 测试函数
 * @returns {Promise<void>}
 */
async function withTempNodeDir(testFn) {
	const dir = await mkdtemp(join(tmpdir(), 'fount-mailbox-int-'))
	initNode({ nodeDir: dir })
	await mkdir(join(dir, 'mailbox'), { recursive: true })
	ensureNodeDefaults()
	try {
		await testFn(dir)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
}

Deno.test('isDeliverableMailboxRecord rejects quarantine and missing fields', () => {
	assertEquals(isDeliverableMailboxRecord({
		app: 'chat',
		envelope: { id: 'e1' },
		tier: 'trusted',
	}), true)
	assertEquals(isDeliverableMailboxRecord({
		app: 'chat',
		envelope: { id: 'e1' },
		tier: 'normal',
	}), true)
	assertEquals(isDeliverableMailboxRecord({
		app: 'chat',
		envelope: { id: 'e1' },
		tier: 'quarantine',
	}), false)
	assertEquals(isDeliverableMailboxRecord({
		app: 'chat',
		tier: 'trusted',
	}), false)
	assertEquals(isDeliverableMailboxRecord({
		envelope: { id: 'e1' },
		tier: 'trusted',
	}), false)
})

Deno.test('publishMailboxRecord stores trusted hop-0 record', async () => {
	await withTempNodeDir(async () => {
		const result = await publishMailboxRecord(USER, RECIPIENT, {
			app: 'chat',
			envelope: { id: 'pub-1' },
			fromNodeHash: FROM_NODE,
		})
		assertEquals(result.stored, true)
		const rows = await getMailboxRecords(['pub-1'])
		assertEquals(rows.length, 1)
		assertEquals(rows[0].tier, 'trusted')
		assertEquals(rows[0].hop, 0)
	})
})

Deno.test('ingestMailboxPut rejects spoofed nodeHash when peerId is not bound', async () => {
	await withTempNodeDir(async () => {
		await ingestMailboxPut({ replicaUsername: USER }, {
			nodeHash: FROM_NODE,
			record: {
				toPubKeyHash: RECIPIENT,
				app: 'chat',
				envelope: { id: 'spoof-1' },
				hop: 0,
			},
		}, 'peer-not-in-roster')
		assertEquals((await getMailboxRecords(['spoof-1'])).length, 0)
	})
})

Deno.test('ingestMailboxPut ignores forged low hop on wire (minimum relay hop 1)', async () => {
	await withTempNodeDir(async () => {
		await ingestMailboxPut({ replicaUsername: USER }, {
			nodeHash: FROM_NODE,
			record: {
				toPubKeyHash: RECIPIENT,
				app: 'chat',
				envelope: { id: 'hop-forge-1' },
				hop: -5,
				tier: 'trusted',
			},
		})
		const rows = await getMailboxRecords(['hop-forge-1'])
		assertEquals(rows.length, 1)
		assertEquals(rows[0].hop, 1)
		assertEquals(rows[0].tier, 'normal')
	})
})

Deno.test('ingestMailboxPut increments hop and stores relayed record', async () => {
	await withTempNodeDir(async () => {
		await ingestMailboxPut({ replicaUsername: USER }, {
			nodeHash: FROM_NODE,
			record: {
				toPubKeyHash: RECIPIENT,
				app: 'chat',
				envelope: { id: 'relay-1' },
				hop: 0,
				tier: 'trusted',
			},
		})
		const rows = await getMailboxRecords(['relay-1'])
		assertEquals(rows.length, 1)
		assertEquals(rows[0].hop, 1)
		assertEquals(rows[0].tier, 'normal')
	})
})

Deno.test('ingestMailboxPut drops at maxHop without storing', async () => {
	await withTempNodeDir(async () => {
		await ingestMailboxPut({ replicaUsername: USER }, {
			nodeHash: FROM_NODE,
			record: {
				toPubKeyHash: RECIPIENT,
				app: 'chat',
				envelope: { id: 'drop-1' },
				hop: 2,
				tier: 'normal',
			},
		})
		assertEquals((await getMailboxRecords(['drop-1'])).length, 0)
	})
})

Deno.test('respondMailboxWant omits quarantine records', async () => {
	await withTempNodeDir(async () => {
		await storeMailboxRecord({
			app: 'chat',
			toPubKeyHash: RECIPIENT,
			envelope: { id: 'want-trusted' },
			hop: 0,
			tier: 'trusted',
			fromNodeHash: FROM_NODE,
		})
		await storeMailboxRecord({
			app: 'chat',
			toPubKeyHash: RECIPIENT,
			envelope: { id: 'want-quarantine' },
			hop: 2,
			tier: 'quarantine',
			fromNodeHash: FROM_NODE,
		})
		/**
		 * 收集已发送记录 id。
		 * @type {string[]}
		 */
		const sentIds = []
		await respondMailboxWant({ replicaUsername: USER }, { toPubKeyHash: RECIPIENT }, (give) => {
			for (const row of give.records || [])
				sentIds.push(row.id)
		}, 'peer-1')
		assertEquals(sentIds, ['want-trusted'])
	})
})

Deno.test('ingestMailboxGive ignores quarantine wire records', async () => {
	await withTempNodeDir(async () => {
		const { ingestMailboxGive } = await import('../mailbox/deliver_or_store.mjs')
		/**
		 * 收集分发结果。
		 * @type {string[]}
		 */
		let seen = []
		registerMailboxConsumer('chat', async (_username, records) => {
			seen = records.map(r => r.id)
			return records.map(r => r.id)
		})
		try {
			const count = await ingestMailboxGive({ replicaUsername: USER }, {
				records: [
					{
						id: 'give-trusted',
						app: 'chat',
						toPubKeyHash: RECIPIENT,
						envelope: { id: 'give-trusted' },
						tier: 'trusted',
					},
					{
						id: 'give-quarantine',
						app: 'chat',
						toPubKeyHash: RECIPIENT,
						envelope: { id: 'give-quarantine' },
						tier: 'quarantine',
					},
				],
			})
			assertEquals(seen, ['give-trusted'])
			assertEquals(count, 1)
		}
		finally {
			unregisterMailboxConsumer('chat')
		}
	})
})

Deno.test('ingestMailboxGive dispatches trusted records to consumers', async () => {
	await withTempNodeDir(async () => {
		registerMailboxConsumer('chat', async (_username, records) => records.map(r => r.id))
		try {
			const delivered = await dispatchMailboxRecordsToConsumers(USER, [
				{
					id: 'c1',
					app: 'chat',
					toPubKeyHash: RECIPIENT,
					envelope: { id: 'c1' },
					tier: 'trusted',
				},
			])
			assertEquals(delivered, ['c1'])
		}
		finally {
			unregisterMailboxConsumer('chat')
		}
	})
})
