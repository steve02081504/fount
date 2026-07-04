/* global Deno */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { walk } from 'https://deno.land/std@0.224.0/fs/walk.ts'

const P2P_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * p2p 生产代码不得 import shell part 内部模块。
 */
Deno.test('p2p production code does not import shell parts', async () => {
	/** @type {string[]} */
	const violations = []
	for await (const entry of walk(P2P_ROOT, { exts: ['.mjs'] })) {
		if (entry.path.includes(`${path.sep}test${path.sep}`)) continue
		if (entry.path.includes(`${path.sep}sim${path.sep}`)) continue
		const text = await Deno.readTextFile(entry.path)
		for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
			const spec = match[1]
			if (spec.includes('public/parts/shells'))
				violations.push(`${path.relative(P2P_ROOT, entry.path)} -> ${spec}`)
		}
	}
	assertEquals(violations, [])
})
