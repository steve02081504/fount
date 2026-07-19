import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

import { ms } from '../../ms.mjs'
import { playwrightOutputDir } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

import { resolveBrowserUseOptions } from './browser.mjs'
import { requireTestBaseUrl } from './env.mjs'

/**
 * 创建 fount E2E 通用 Playwright 配置。
 * @param {object} options 配置选项
 * @param {string} options.testDir 用例目录（绝对或相对 repo 根）
 * @param {Partial<import('@playwright/test').PlaywrightTestConfig>} [options.overrides] 覆盖项
 * @returns {Promise<import('@playwright/test').PlaywrightTestConfig>} Playwright 配置对象
 */
export async function createPlaywrightConfig({ testDir, overrides = {} }) {
	const browserUse = await resolveBrowserUseOptions()
	// phasesFromPlaywrightConfig 会在自启节点前 import 本配置；此时尚无 FOUNT_TEST_BASE_URL。
	const baseURL = process.env.FOUNT_TEST_BASE_URL?.trim()
		? requireTestBaseUrl()
		: 'http://127.0.0.1:1'
	const scope = process.env.FOUNT_TEST_SCOPE || 'default'
	return defineConfig({
		testDir,
		testMatch: '*.spec.mjs',
		outputDir: playwrightOutputDir(REPO_ROOT, scope),
		timeout: ms('1m'),
		expect: { timeout: ms('20s') },
		workers: 1,
		retries: process.env.CI ? 1 : 0,
		reporter: process.env.CI ? 'github' : 'list',
		use: {
			baseURL,
			headless: true,
			trace: 'retain-on-failure',
			...browserUse,
		},
		...overrides,
	})
}

/**
 * 多阶段 shell 前端 Playwright 配置（chat/social/cabinet 共用）。
 * @param {string} importMetaUrl 调用方 `import.meta.url`
 * @param {{ name: string, testMatch: string | string[] }[]} phases 阶段列表
 * @param {object} [options] 选项
 * @param {number} [options.timeout=300000] 用例超时毫秒
 * @returns {Promise<import('@playwright/test').PlaywrightTestConfig>} Playwright 配置
 */
export function createPhasedPlaywrightConfig(importMetaUrl, phases, options = {}) {
	return createPlaywrightConfig({
		testDir: dirname(fileURLToPath(importMetaUrl)),
		overrides: {
			timeout: options.timeout ?? 300_000,
			projects: phases.map(p => ({ name: p.name, testMatch: p.testMatch })),
		},
	})
}
