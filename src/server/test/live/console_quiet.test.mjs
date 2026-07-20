/**
 * 回归：模拟用户直接运行 `fount server` 的真实默认启动（`starts: {}` → server.mjs 全开），
 * 不走测试 harness 的静默 starts 预设，也不注入 loopback / mock relay。
 * IPC 端口由 harness 写入 `starts.IPC.port`，可与并行 live 节点共存。
 *
 * TODO(denoland/deno#36176): 当前必须 `Base: { AutoUpdate: false }`。
 * 节点 shutdown → idle → `deno upgrade` 会 unlink 宿主 Deno，Linux 上父进程
 * `Deno.execPath()` 变成 `… (deleted)`，后续 launchNode ENOENT。
 * 该 issue 合入后：改回 `starts: {}`，删掉本段 TODO 与 AutoUpdate 覆盖。
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
		// deno#36176 未修前勿改回 starts: {}
		starts: { Base: { AutoUpdate: false } },
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
