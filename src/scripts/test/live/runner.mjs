/**
 * Shell live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { execFile } from 'npm:@steve02081504/exec'

import { launchNode, stopNode } from '../node/launch.mjs'

const FEDERATION_CLEANUP = join('src', 'scripts', 'test', 'live', 'federation', 'cleanup.ps1')

/**
 * 在仓库根目录执行子进程命令。
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} command 可执行文件 + 参数
 * @param {Record<string, string>} env 额外环境变量
 * @returns {Promise<{ code: number, output: string }>} 子进程退出码与合并输出
 */
async function runCommand(repoRoot, command, env) {
	const [executable, ...args] = command
	const output = await execFile(executable, args, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
	})
	return { code: output.code, output: output.stdall }
}

/**
 * 启动节点、运行指定 live suite 并 teardown。
 * @param {object} options 运行选项
 * @param {string} options.suiteName manifest / suites 中的名称
 * @param {Record<string, { fed?: boolean, run: string[], node?: object }>} options.suites suite 表
 * @param {string} options.repoRoot 仓库根目录
 * @param {object} options.nodeA 节点 A 基础 launchNode 选项
 * @param {object} options.nodeB 节点 B 基础 launchNode 选项（联邦）
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runLiveSuite({
	suiteName,
	suites,
	repoRoot,
	nodeA,
	nodeB,
}) {
	const spec = suites[suiteName]
	if (!spec) {
		console.error(`unknown suite: ${suiteName}`)
		console.error('available:', Object.keys(suites).join(', '))
		return 2
	}

	const nodes = []
	const federationCleanup = join(repoRoot, FEDERATION_CLEANUP)
	try {
		nodes.push(await launchNode({ ...nodeA, ...spec.node }))
		if (spec.fed)
			nodes.push(await launchNode({ ...nodeB, ...spec.node }))

		const [nodeAHandle, nodeBHandle] = nodes
		const env = {
			FOUNT_API_KEY: nodeAHandle.apiKey,
			FOUNT_NODE_A_DATA: nodeAHandle.dataPath,
			FOUNT_TEST_BASE_URL: nodeAHandle.baseUrl,
			FOUNT_TEST_REPO_ROOT: repoRoot,
		}
		if (nodeBHandle) {
			env.FOUNT_NODE_B_DATA = nodeBHandle.dataPath
			env.FOUNT_TEST_NODE_B_BASE_URL = nodeBHandle.baseUrl
			env.FOUNT_TEST_NODE_B_PORT = String(nodeBHandle.port)
			env.FOUNT_TEST_NODE_B_KEY = nodeBHandle.apiKey
		}

		if (spec.fed) {
			const pre = await runCommand(repoRoot, ['pwsh', '-NoProfile', '-File', federationCleanup], env)
			if (pre.code !== 0) console.warn('federation cleanup pre:', pre.output)
		}

		console.log(`\n=== SUITE ${suiteName} ===`)
		const result = await runCommand(repoRoot, spec.run, env)
		if (result.output) console.log(result.output)

		if (spec.fed) {
			const post = await runCommand(repoRoot, ['pwsh', '-NoProfile', '-File', federationCleanup], env)
			if (post.code !== 0) console.warn('federation cleanup post:', post.output)
		}

		return result.code
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
 * @param {string} options.repoRoot 仓库根目录
 * @param {object} options.nodeA 节点 A 基础选项
 * @param {object} options.nodeB 节点 B 基础选项
 * @param {string} [options.defaultSuite] 默认 suite 名
 * @returns {Promise<void>}
 */
export async function runLiveSuiteCli({ suites, repoRoot, nodeA, nodeB, defaultSuite }) {
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

	process.exit(await runLiveSuite({
		suiteName: values.suite,
		suites,
		repoRoot,
		nodeA,
		nodeB,
	}))
}
