/* global Deno */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts'

const P2P_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * p2p 生产代码不得 import shell/server 或硬编码 social 业务。
 */
Deno.test('p2p production code import boundary', async () => {
	/** @type {string[]} */
	const violations = []
	for await (const entry of walk(P2P_ROOT, { exts: ['.mjs'] })) {
		if (entry.path.includes(`${path.sep}test${path.sep}`)) continue
		if (entry.path.includes(`${path.sep}sim${path.sep}`)) continue
		const text = await Deno.readTextFile(entry.path)
		const rel = path.relative(P2P_ROOT, entry.path)
		if (/\bsocial_rpc\b/u.test(text))
			violations.push(`${rel}: social_rpc literal`)
		if (/getShellPartpath\(\s*['"]social['"]\s*\)/u.test(text))
			violations.push(`${rel}: getShellPartpath('social')`)
		for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
			const spec = match[1]
			if (spec.includes('public/parts/shells'))
				violations.push(`${rel} -> ${spec} (shell parts)`)
			if (spec.includes('shells/social'))
				violations.push(`${rel} -> ${spec} (shells/social)`)
			if (/^(?:\.\.\/)*server\//u.test(spec) || spec.startsWith('fount/server/'))
				violations.push(`${rel} -> ${spec} (server)`)
		}
	}
	assertEquals(violations, [])
})
