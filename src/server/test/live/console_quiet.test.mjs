/**
 * 回归：默认启动语义下，
 * 服务器 ready 后 10 秒内不应继续自行输出控制台日志。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../../../scripts/ms.mjs'
import { launchNode, pickAvailablePort, stopNode } from '../../../scripts/test/node/launch.mjs'

Deno.test({
	name: 'server console stays quiet for 10s under default starts',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const port = await pickAvailablePort(29031)
	const node = await launchNode({
		port,
		username: 'quiet-http-user',
		apiKey: `fount-quiet-http-${Date.now().toString(36)}`,
		needsOutput: true,
		starts: {},
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
