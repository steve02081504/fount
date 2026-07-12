/**
 * 浏览器从 /scripts/* 加载的共用静态资源门控（见 resources.mjs：仅暴露 public/pages/scripts）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { launchNode, pickAvailablePort, stopNode } from '../../../scripts/test/node/launch.mjs'

/** @type {string[]} */
const BROWSER_SCRIPTS = [
	'/parts/shells:chat/shared/entityHash.mjs',
	'/parts/shells:chat/shared/digest.mjs',
	'/parts/shells:chat/shared/mentions.mjs',
	'/parts/shells:chat/shared/inlineTokens.mjs',
	'/parts/shells:chat/shared/hashAvatar.mjs',
	'/scripts/infiniteScroll.mjs',
	'/scripts/test/ready_gate.mjs',
]

Deno.test({
	name: 'browser shared static scripts are served',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const port = await pickAvailablePort(28931)
	const node = await launchNode({
		port,
		username: 'static-scripts-user',
		apiKey: `fount-static-scripts-${Date.now().toString(36)}`,
	})
	const { baseUrl } = node
	try {
		for (const path of BROWSER_SCRIPTS) {
			const res = await fetch(`${baseUrl}${path}`)
			assertEquals(res.status, 200, path)
			const body = await res.text()
			assertEquals(body.includes('export'), true, `${path} should be an ES module`)
		}
	}
	finally {
		await stopNode(node)
	}
})
