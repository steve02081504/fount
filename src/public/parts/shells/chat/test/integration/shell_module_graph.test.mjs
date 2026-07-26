/**
 * Chat shell 前后端加载 smoke。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { defaultRepoRoot, probeShellPart } from '../../../../../../scripts/test/shellLoadProbe.mjs'

const repoRoot = defaultRepoRoot()

Deno.test('chat shell module graph resolves without cross-boundary leaks', async () => {
	const { backendMissing, publicMissing, crossBoundary, missingNamed } = await probeShellPart({
		repoRoot,
		partPath: 'shells/chat',
	})
	assertEquals(backendMissing, [])
	assertEquals(publicMissing, [])
	assertEquals(crossBoundary, [])
	assertEquals(missingNamed, [])
})
