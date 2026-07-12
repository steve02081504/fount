/* global Deno */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts'

const P2P_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

/**
 * 相对 import 规范化后是否逃出 P2P_ROOT。
 * @param {string} spec import 说明符
 * @param {string} fromFile 引用方绝对路径
 * @returns {boolean} 是否逃出包根
 */
function importEscapesPackageRoot(spec, fromFile) {
	if (!spec.startsWith('.')) return false
	const resolved = path.resolve(path.dirname(fromFile), spec)
	const rel = path.relative(P2P_ROOT, resolved)
	return rel.startsWith('..') || path.isAbsolute(rel)
}

/**
 * p2p 生产代码不得 import shell/server、逃出包根，或硬编码 chat/social 业务。
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
		if (/fount:chat:/u.test(text))
			violations.push(`${rel}: fount:chat: literal`)
		if (/fount:chat:agent:/u.test(text))
			violations.push(`${rel}: fount:chat:agent: literal`)
		if (/\bagentEntityHash\b/u.test(text))
			violations.push(`${rel}: agentEntityHash literal`)
		for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
			const spec = match[1]
			if (spec.includes('public/parts/shells'))
				violations.push(`${rel} -> ${spec} (shell parts)`)
			if (spec.includes('shells/social'))
				violations.push(`${rel} -> ${spec} (shells/social)`)
			if (/^(?:\.\.\/)*server\//u.test(spec) || spec.startsWith('fount/server/'))
				violations.push(`${rel} -> ${spec} (server)`)
			if (importEscapesPackageRoot(spec, entry.path))
				violations.push(`${rel} -> ${spec} (escapes package root)`)
		}
	}
	assertEquals(violations, [])
})
