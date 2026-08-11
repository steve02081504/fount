/**
 * 复现 chat frontend emoji picker：节点只预载 chat，首次打 social emoji API 触发懒 Load。
 * 该请求必须在合理时间内返回，否则共享 picker 永远等不到 rail。
 */
/* global Deno */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNode, stopNode } from 'fount/scripts/test/node/launch.mjs'
import { assert, assertEquals } from 'jsr:@std/assert'

const bootstrapPath = join(dirname(fileURLToPath(import.meta.url)), '../node_bootstrap.mjs')
const SOCIAL_PREFIX = '/api/parts/shells:social'

Deno.test({
	name: 'lazy social Load + emoji-packs/available completes under chat-only preload',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const dataPath = await mkdtemp(join(tmpdir(), 'fount_social_emoji_lazy_'))
	const node = await launchNode({
		dataPath,
		username: 'chat-fe-emoji-lazy',
		apiKey: `fount-emoji-lazy-${Date.now().toString(36)}`,
		loadParts: ['shells/chat'],
		bootstrap: bootstrapPath,
		p2p: true,
		minP2pNode: true,
	})
	try {
		const url = `${node.baseUrl}${SOCIAL_PREFIX}/emoji-packs/available?fount-apikey=${encodeURIComponent(node.apiKey)}`
		const started = Date.now()
		const response = await fetch(url)
		const elapsed = Date.now() - started
		const raw = await response.text()
		assertEquals(response.status, 200, raw)
		const body = JSON.parse(raw)
		assert(Array.isArray(body.packs), raw)
		assert(elapsed < 5_000, `lazy social emoji-packs/available took ${elapsed}ms`)
	}
	finally {
		await stopNode(node)
	}
})
