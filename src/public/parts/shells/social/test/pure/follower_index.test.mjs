/**
 * follower 索引模块导出约束（纯模块检查，不启动 server）。
 */
/* global Deno */
import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('follower index module exposes p2p social layer helpers', async () => {
	const mod = await import('fount/scripts/p2p/social/follower_index.mjs')
	assert(typeof mod.listReplicaUsernamesFollowing === 'function')
	assert(typeof mod.rebuildFollowerIndex === 'function')
})
