/**
 * Shell live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 *
 *   import { runLiveSuiteCli } from 'fount/scripts/test/live_suite_runner.mjs'
 *   runLiveSuiteCli({ suites, scriptsDir, repoRoot, nodeA, nodeB, fedCleanup })
 */
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { execFile } from 'npm:@steve02081504/exec'

import { launchNode, stopNode } from './launch_node.mjs'

/**
 * 在仓库根目录执行子进程命令。
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} command 可执行文件 + 参数
 * @param {Record<string, string>} env 额外环境变量
 * @returns {Promise<{ code: number, output: string }>} 子进程退出码与合并输出
 */
async function runCommand(repoRoot, command, env) {
	const [executable, ...args] = command
	const out = await execFile(executable, args, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
	})
	return { code: out.code, output: out.stdout + out.stderr }
}

/**
 * 解析 live 脚本输出中的失败标记。
 * @param {number} exitCode 子进程退出码
 * @param {string} output 合并 stdout/stderr
 * @returns {number} 最终退出码
 */
function finalizeExitCode(exitCode, output) {
	if (exitCode !== 0) return exitCode
	if (/\bFAIL:\s|FAIL=(\d+)/.test(output)) {
		const match = output.match(/FAIL=(\d+)/)
		if (match && Number(match[1]) > 0) return 1
	}
	if (/\bFAIL\s{2,}/m.test(output)) return 1
	return 0
}

/**
 * 启动节点、运行指定 live suite 并 teardown。
 * @param {object} options 运行选项
 * @param {string} options.suiteName manifest / suites 中的名称
 * @param {Record<string, { fed?: boolean, run: string[], node?: object }>} options.suites suite 表
 * @param {string} options.repoRoot 仓库根目录
 * @param {string} options.fedCleanup fed_cleanup.ps1 绝对路径
 * @param {object} options.nodeA 节点 A 基础 launchNode 选项
 * @param {object} options.nodeB 节点 B 基础 launchNode 选项（联邦）
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runLiveSuite({
	suiteName,
	suites,
	repoRoot,
	fedCleanup,
	nodeA,
	nodeB,
}) {
	const spec = suites[suiteName]
	if (!spec) {
		console.error(`unknown suite: ${suiteName}`)
		console.error('available:', Object.keys(suites).join(', '))
		return 2
	}

	/** @type {Awaited<ReturnType<typeof launchNode>>[]} */
	const nodes = []
	try {
		nodes.push(await launchNode({ ...nodeA, ...spec.node }))
		if (spec.fed)
			nodes.push(await launchNode({ ...nodeB, ...spec.node }))

		const nodeAHandle = nodes[0]
		const env = {
			FOUNT_API_KEY: nodeAHandle.apiKey,
			FOUNT_NODE_A_DATA: nodeAHandle.dataPath,
			FOUNT_TEST_BASE_URL: nodeAHandle.baseUrl,
			FOUNT_TEST_REPO_ROOT: repoRoot,
		}
		if (nodes[1]) {
			env.FOUNT_NODE_B_DATA = nodes[1].dataPath
			env.FOUNT_TEST_NODE_B_PORT = String(nodes[1].port)
			env.FOUNT_TEST_NODE_B_KEY = nodes[1].apiKey
		}

		if (spec.fed) {
			const pre = await runCommand(repoRoot, ['pwsh', '-NoProfile', '-File', fedCleanup], env)
			if (pre.code !== 0) console.warn('fed_cleanup pre:', pre.output)
		}

		console.log(`\n=== SUITE ${suiteName} ===`)
		const result = await runCommand(repoRoot, spec.run, env)
		if (result.output) console.log(result.output)

		if (spec.fed) {
			const post = await runCommand(repoRoot, ['pwsh', '-NoProfile', '-File', fedCleanup], env)
			if (post.code !== 0) console.warn('fed_cleanup post:', post.output)
		}

		return finalizeExitCode(result.code, result.output)
	}
	finally {
		for (const node of nodes.reverse())
			await stopNode(node)
	}
}

/**
 * 解析 CLI 参数并运行 live suite（供各 shell test/live/run.mjs 调用）。
 * @param {object} options CLI 配置
 * @param {Record<string, { fed?: boolean, run: string[], node?: object }>} options.suites suite 表
 * @param {string} options.scriptsDir live/scripts 目录
 * @param {string} options.repoRoot 仓库根目录
 * @param {object} options.nodeA 节点 A 基础选项
 * @param {object} options.nodeB 节点 B 基础选项
 * @param {string} [options.defaultSuite] 默认 suite 名
 * @returns {Promise<void>}
 */
export async function runLiveSuiteCli({
	suites,
	scriptsDir,
	repoRoot,
	nodeA,
	nodeB,
	defaultSuite,
}) {
	const fedCleanup = join(repoRoot, 'src/scripts/test/fed_cleanup.ps1')
	const { values } = parseArgs({
		options: {
			suite: { type: 'string', default: defaultSuite },
			list: { type: 'boolean', default: false },
		},
	})

	if (values.list) {
		console.log(Object.keys(suites).join('\n'))
		process.exit(0)
	}

	if (!values.suite) {
		console.error('usage: --suite <name> | --list')
		process.exit(2)
	}

	const code = await runLiveSuite({
		suiteName: values.suite,
		suites,
		repoRoot,
		fedCleanup,
		nodeA,
		nodeB,
	})
	process.exit(code)
}
