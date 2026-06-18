/**
 * Social live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 *
 *   deno run --allow-all src/public/parts/shells/social/test/live/run.mjs --suite e2e_single
 */
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { execFile } from 'npm:@steve02081504/exec'

import { launchNode, stopNode } from '../../../../../../../.github/workflows/test_lib/launch_node.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(__dirname, 'scripts')
const REPO_ROOT = resolve(__dirname, '../../../../../../../')

const NODE_PORT = Number(process.env.FOUNT_TEST_NODE_A_PORT) || 8931

/** @type {Record<string, { run: string[] }>} */
const SUITES = {
	e2e_single: { run: ['pwsh', '-NoProfile', '-File', join(SCRIPTS, 'e2e_single.ps1')] },
	cross_shell_emoji: { run: ['pwsh', '-NoProfile', '-File', join(SCRIPTS, 'cross_shell_emoji.ps1')] },
	ws_test: { run: ['node', join(SCRIPTS, 'ws_test.mjs')] },
}

/**
 * 在仓库根目录执行子进程命令。
 * @param {string[]} cmd 可执行文件 + 参数
 * @param {Record<string, string>} env 额外环境变量
 * @returns {Promise<{ code: number, output: string }>} 退出码与合并输出
 */
async function runCommand(cmd, env) {
	const [exe, ...args] = cmd
	const out = await execFile(exe, args, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
	})
	return { code: out.code, output: out.stdout + out.stderr }
}

/**
 * 启动节点、运行指定 live suite 并 teardown。
 * @param {string} suiteName manifest / SUITES 中的名称
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
async function runSuite(suiteName) {
	const spec = SUITES[suiteName]
	if (!spec) {
		console.error(`unknown suite: ${suiteName}`)
		console.error('available:', Object.keys(SUITES).join(', '))
		return 2
	}

	/** @type {Awaited<ReturnType<typeof launchNode>>[]} */
	const nodes = []
	try {
		nodes.push(await launchNode({
			port: NODE_PORT,
			username: 'CI-user',
			apiKey: process.env.FOUNT_TEST_NODE_A_KEY || `fount-ci-social-key-${NODE_PORT}`,
		}))

		const node = nodes[0]
		const env = {
			FOUNT_API_KEY: node.apiKey,
			FOUNT_TEST_BASE_URL: node.baseUrl,
		}

		console.log(`\n=== SUITE ${suiteName} ===`)
		const result = await runCommand(spec.run, env)
		if (result.output) console.log(result.output)

		if (result.code !== 0) return result.code
		if (/\bFAIL:\s|FAIL=(\d+)/.test(result.output)) {
			const m = result.output.match(/FAIL=(\d+)/)
			if (m && Number(m[1]) > 0) return 1
		}
		if (/\bFAIL\s{2,}/m.test(result.output)) return 1
		return 0
	}
	finally {
		for (const node of nodes)
			await stopNode(node)
	}
}

const { values } = parseArgs({
	options: { suite: { type: 'string', default: 'e2e_single' } },
})

const code = await runSuite(values.suite)
process.exit(code)
