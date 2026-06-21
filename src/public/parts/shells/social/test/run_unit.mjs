/**
 * Social 单元测试 driver：串行跑集成用例（共享 harness 单例 + 单用户磁盘状态）。
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const args = [
	'test', '--no-check', '--allow-all', '-c', './deno.json',
	'--ignore=src/public/parts/shells/social/test/live',
	'./src/public/parts/shells/social/test/',
	'./src/test/registries.test.mjs',
	'./src/test/pickers.test.mjs',
]
const out = spawnSync('deno', args, {
	cwd: REPO_ROOT,
	env: { ...process.env, DENO_JOBS: '1' },
	stdio: 'inherit',
})
process.exit(out.status ?? 1)
