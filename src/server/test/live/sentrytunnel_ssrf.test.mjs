/**
 * /api/sentrytunnel 未认证可达；只能转发到本机配置的 Sentry 项目。
 * 若信任 envelope 头里的任意 DSN，攻击者可让服务器向任意 https 主机发起 POST（SSRF）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * 构造 Sentry envelope（首行为含 DSN 的 JSON 头）。
 * @param {string} dsn envelope DSN
 * @returns {string} envelope 文本
 */
function buildEnvelope(dsn) {
	return `${JSON.stringify({ dsn, event_id: '0'.repeat(32) })}\n${JSON.stringify({ type: 'event' })}\n{}\n`
}

Deno.test({
	name: '/api/sentrytunnel rejects a DSN pointing at an attacker host',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'sentrytunnel-ssrf-user',
		apiKey: `fount-sentrytunnel-${Date.now().toString(36)}`,
		// 打开 Sentry，确保走到 DSN 校验 + 上游 fetch 代码路径（默认测试节点关闭 Sentry）。
		extraEnv: { FOUNT_TEST_SENTRY: '1' },
	})
	try {
		const res = await fetch(`${node.baseUrl}/api/sentrytunnel`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-sentry-envelope' },
			body: buildEnvelope('https://attacker.example/1'),
		})
		const body = await res.json().catch(() => null)
		assertEquals(
			res.status,
			400,
			`attacker DSN must be rejected before any outbound fetch (got ${res.status}: ${JSON.stringify(body)})`,
		)
	}
	finally {
		await stopNode(node)
	}
})
