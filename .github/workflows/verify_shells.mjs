/**
 * CI shell 测试入口（GitHub Actions / 本地 fount test）。
 */
import process from 'node:process'

import { runTests } from '../../src/scripts/test/runner/index.mjs'

process.exit(await runTests({
	runAll: process.env.FOUNT_TEST_RUN_ALL === '1',
}))
