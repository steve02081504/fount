/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { deliver, deliverToUserRoomPeers } from '../deliver.mjs'
import { initNode } from '../node/instance.mjs'

Deno.test('deliver returns false for blank target node hash', async () => {
	assertEquals(await deliver('test-user', '', 'mailbox-give', {}), false)
	assertEquals(await deliver('test-user', '   ', 'mailbox-give', {}), false)
})

Deno.test('deliverToUserRoomPeers returns 0 when user room is unavailable', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-deliver-'))
	try {
		await mkdir(dir, { recursive: true })
		await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeSeedHex: Buffer.alloc(32, 3).toString('hex') }))
		initNode({ nodeDir: dir })
		assertEquals(await deliverToUserRoomPeers('__no_such_user__', 'mailbox-give', { x: 1 }), 0)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})
