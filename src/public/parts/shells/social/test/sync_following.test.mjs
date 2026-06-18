/**
 * follower 索引层：薄封装在 p2p social，无 legacy following.json 旁路。
 * following 读写集成见 batch1_timeline.test.mjs。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

Deno.test('follower index lives in p2p social layer', async () => {
	const url = new URL('../../../../../scripts/p2p/social/follower_index.mjs', import.meta.url)
	const text = await readFile(fileURLToPath(url), 'utf8')
	assert(text.includes('listReplicaUsernamesFollowing'))
	assert(text.includes('follower_index'))
	assert(text.includes('followerEntryCache'))
	assert(!text.includes('legacyPath'))
})
