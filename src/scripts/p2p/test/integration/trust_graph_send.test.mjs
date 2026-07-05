/**
 * trust_graph sendToNode / user_room 定向投递单元测试。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { initTestP2pNode } from '../../test/helpers/node.mjs'
import {
	createDefaultTrustGraphProvider,
	DEFAULT_TRUST_GRAPH_OWNER,
	registerTrustGraphProvider,
	requireTrustGraphProvider,
} from '../../trust_graph_registry.mjs'
import { deliverToUserRoomPeers } from '../../user_room.mjs'

Deno.test('sendToNode returns false for blank target node hash', async () => {
	registerTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER, createDefaultTrustGraphProvider())
	assertEquals(await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).sendToNode('test-user', '', 'mailbox-give', {}), false)
	assertEquals(await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).sendToNode('test-user', '   ', 'mailbox-give', {}), false)
})

Deno.test('deliverToUserRoomPeers returns 0 when user room is unavailable', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'fount-deliver-'))
	try {
		await mkdir(dir, { recursive: true })
		await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeSeedHex: Buffer.alloc(32, 3).toString('hex') }))
		initTestP2pNode({ nodeDir: dir })
		assertEquals(await deliverToUserRoomPeers('__no_such_user__', 'mailbox-give', { x: 1 }), 0)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})
