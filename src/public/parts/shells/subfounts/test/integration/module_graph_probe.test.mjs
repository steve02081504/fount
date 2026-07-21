/**
 * Subfounts shell 前后端加载 smoke。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { defaultRepoRoot, probeShellPart } from '../../../../../../scripts/test/shellLoadProbe.mjs'

const repoRoot = defaultRepoRoot()

Deno.test('subfounts shell module graph resolves without cross-boundary leaks', async () => {
	const { backendMissing, publicMissing, crossBoundary } = await probeShellPart({
		repoRoot,
		partPath: 'shells/subfounts',
	})
	assertEquals(backendMissing, [])
	assertEquals(publicMissing, [])
	assertEquals(crossBoundary, [])
})
