/**
 * Wechatbot shell 模块图 smoke：路径解析 + 具名导出（拦住 shared 重命名漏改）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { defaultRepoRoot, probeShellPart } from '../../../../../../scripts/test/shellLoadProbe.mjs'

const repoRoot = defaultRepoRoot()

Deno.test('wechatbot shell module graph resolves named imports', async () => {
	const { backendMissing, publicMissing, crossBoundary, missingNamed } = await probeShellPart({
		repoRoot,
		partPath: 'shells/wechatbot',
		dynamicProbes: [],
	})
	assertEquals(backendMissing, [])
	assertEquals(publicMissing, [])
	assertEquals(crossBoundary, [])
	assertEquals(missingNamed, [])
})
