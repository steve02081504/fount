/**
 * 前端多阶段 driver 的临时 report 目录生命周期：空选择不得遗留工作目录。
 * 历史泄漏：`runFrontendPhases` 在进入 try/finally 前创建 `data/test/fount-pw-json-*`，
 * 空选择提前 `return 2` 会把它留在磁盘上（曾累积上百个）。
 */
/* global Deno */
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { runFrontendPhases } from '../playwright/phases.mjs'

/**
 * 列出仓库根 `data/test` 下的 `fount-pw-json-*` 目录名。
 * @param {string} repoRoot 临时仓库根
 * @returns {Promise<string[]>} 目录名（排序）
 */
async function jsonReportDirs(repoRoot) {
	const entries = await readdir(join(repoRoot, 'data', 'test')).catch(() => [])
	return entries.filter(name => name.startsWith('fount-pw-json-')).sort()
}

Deno.test('runFrontendPhases 空选择不遗留 report 目录', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-phases-'))
	try {
		await mkdir(join(repoRoot, 'data', 'test'), { recursive: true })
		const code = await runFrontendPhases({
			configPath: join(repoRoot, 'playwright.config.mjs'),
			repoRoot,
			basePort: 40000,
			// 空阶段列表 → selected 为空 → 提前 return 2
			phases: [],
			env: {},
			/**
			 * @returns {object} 空启动选项
			 */
			nodeOpts: () => ({}),
		})
		assertEquals(code, 2)
		assertEquals(await jsonReportDirs(repoRoot), [], '空选择不应遗留 fount-pw-json-* 目录')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
