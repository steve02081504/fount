/* global Deno */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { nodeHashFromSeed } from '../../entity/node_hash.mjs'
import { initNode } from '../../node/instance.mjs'

Deno.test('resolveUserRoomCredentials derives deterministic room secret', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-user-room-'))
	try {
		await mkdir(dir, { recursive: true })
		const seedHex = Buffer.alloc(32, 7).toString('hex')
		await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeSeedHex: seedHex }))
		initNode({ nodeDir: dir })
		const nodeHash = nodeHashFromSeed(seedHex)
		const { resolveUserRoomCredentials } = await import('../../user_room.mjs')
		const creds = resolveUserRoomCredentials()
		const expected = createHash('sha256').update(`fount-user-room:${nodeHash}`).digest('hex')
		assertEquals(creds.password, expected)
		assertEquals(creds.roomId, `fount-node-${nodeHash}`)
		assertEquals(creds.nodeHash, nodeHash)
		assertEquals(creds.appId, 'fount-user-fed')
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})
