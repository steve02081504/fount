/* global Deno */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'

import { bootHeadlessDataRoot, initFountNode } from 'fount/scripts/test/node/boot.mjs'

import { createChatFederationSim } from '../simulation/federation.mjs'

/**
 * 回归：同进程 headless boot 进程级共享且一次性。
 * 覆盖「第二次 createChatFederationSim 因换盘触发 p2p nodeDir 冲突」的 harness bug。
 * @returns {Promise<void>} 无
 */
Deno.test('headless boot is process-shared and one-shot', async () => {
	const first = await createChatFederationSim()
	const second = await createChatFederationSim()
	// same underlying data root, distinct runTag namespacing
	assertEquals(second.dataRoot, first.dataRoot)
	assert(first.runTag !== second.runTag, 'runTag must be unique per sim')
	// bootHeadlessDataRoot agrees with the shared root and returns an object
	const { dataPath } = await bootHeadlessDataRoot()
	assertEquals(dataPath, first.dataRoot)
	// re-initializing a different data path must be refused, not hit the p2p throw
	// (the guard rejects before any filesystem access, so the path need not exist)
	const otherPath = join(tmpdir(), `fount_reinit_guard_${crypto.randomUUID()}`, 'root')
	await assertRejects(() => initFountNode({ dataPath: otherPath }), /already ran in this process/)
})
