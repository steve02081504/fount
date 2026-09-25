/**
 * Deskpet shell 前后端加载 smoke：模块图可解析、Home 角色入口指向真实页面。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { defaultRepoRoot, probeShellPart } from '../../../../../../scripts/test/shellLoadProbe.mjs'

const repoRoot = defaultRepoRoot()

Deno.test('deskpet shell module graph resolves without cross-boundary leaks', async () => {
	const { backendMissing, publicMissing, crossBoundary, missingNamed } = await probeShellPart({
		repoRoot,
		partPath: 'shells/deskpet',
	})
	assertEquals(backendMissing, [])
	assertEquals(publicMissing, [])
	assertEquals(crossBoundary, [])
	assertEquals(missingNamed, [])
})

Deno.test('deskpet home char interface links to the launcher page', async () => {
	const registry = JSON.parse(await readFile(
		path.join(repoRoot, 'src/public/parts/shells/deskpet/home_registry.json'),
		'utf8',
	))
	const entries = registry.home_interfaces.chars
	assertEquals(entries.length > 0, true)
	for (const entry of entries) {
		assertEquals(entry.interface, 'deskpet')
		assertEquals(entry.url, '/parts/shells:deskpet/?char=${name}')
	}
})
