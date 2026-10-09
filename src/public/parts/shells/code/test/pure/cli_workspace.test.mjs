/* global Deno */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { resolveCodeWorkspace } from '../../cli/workspace.mjs'

Deno.test('code workspace detects the closest .git/config and honors explicit paths', () => {
	const root = mkdtempSync(join(tmpdir(), 'code-workspace-'))
	try {
		const nested = join(root, 'nested')
		const cwd = join(nested, '项目')
		mkdirSync(cwd, { recursive: true })
		assertEquals(resolveCodeWorkspace(cwd), cwd)
		mkdirSync(join(root, '.git'))
		writeFileSync(join(root, '.git', 'config'), '')
		assertEquals(resolveCodeWorkspace(cwd), root)
		assertEquals(resolveCodeWorkspace(root), root)
		assertEquals(resolveCodeWorkspace(cwd, '.'), cwd)
		assertEquals(resolveCodeWorkspace(cwd, '..'), nested)
		assertEquals(resolveCodeWorkspace(cwd, nested), nested)
		mkdirSync(join(nested, '.git', 'config'), { recursive: true })
		assertEquals(resolveCodeWorkspace(cwd), root)
		rmSync(join(nested, '.git', 'config'), { recursive: true })
		writeFileSync(join(nested, '.git', 'config'), '')
		assertEquals(resolveCodeWorkspace(cwd), nested)
	}
	finally { rmSync(root, { recursive: true, force: true }) }
})
