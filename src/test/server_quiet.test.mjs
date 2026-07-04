/**
 * 回归：空闲测试节点在 ready 后不应继续自行输出。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../scripts/ms.mjs'
import { launchNode, stopNode } from '../scripts/test/node/launch.mjs'

Deno.test({
	name: 'server stays silent for 10s after init without jobs or web access',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'quiet-http-user',
		apiKey: `fount-quiet-http-${Date.now().toString(36)}`,
		captureOutput: true,
	})
	try {
		await new Promise(resolve => setTimeout(resolve, ms('10s')))
		assertEquals(node.takeOutput(), '')
	}
	finally {
		await stopNode(node)
	}
})
