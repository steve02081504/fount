/**
 * 回归：这里刻意模拟用户直接运行 `fount server` 的真实默认启动，
 * 不走测试 harness 的静默 starts 预设，也不注入 loopback / mock relay。
 * 目标是观察用户真实启动 fount 后 10 秒内是否有错误或噪声。
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
