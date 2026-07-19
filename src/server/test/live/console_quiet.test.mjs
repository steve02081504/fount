/**
 * 回归：模拟用户直接运行 `fount server` 的真实默认启动（`starts: {}` → server.mjs 全开），
 * 不走测试 harness 的静默 starts 预设，也不注入 loopback / mock relay。
 * IPC 端口由 harness 写入 `starts.IPC.port`，可与并行 live 节点共存。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../../../scripts/ms.mjs'
import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

Deno.test({
	name: 'server console stays quiet for 10s under default starts',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
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
