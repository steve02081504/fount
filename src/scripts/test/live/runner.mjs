/**
 * Shell live 测试 driver：自启 fount 节点并运行 scripts/ 下对应脚本。
 */
import { join } from 'node:path'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { console } from '../../i18n/bare.mjs'
import { parseArgsOrExit } from '../core/parse_args_or_exit.mjs'
import { launchNode, resolveLiveNodeFleet, stopNode } from '../node/launch.mjs'
import { appendBoundedTail } from '../runner/run_command.mjs'

import { denoLiveRun } from './deno_run.mjs'

const FEDERATION_CLEANUP = join('src', 'scripts', 'test', 'live', 'federation', 'cleanup.mjs')

/**
 * 在仓库根目录执行子进程命令。
 * @param {string} repoRoot 仓库根目录
 * @param {string[]} command 可执行文件 + 参数
 * @param {Record<string, string>} env 额外环境变量
 * @param {object} [options] 执行选项
 * @param {boolean} [options.stream=false] 是否实时转发 stdout/stderr（使噪声窗口标记与 node stderr 按时间交错）
 * @returns {Promise<{ code: number, output: string }>} 子进程退出码与合并输出
 */
async function runCommand(repoRoot, command, env, options = {}) {
	const { stream = false } = options
	const [executable, ...args] = command
	let outputTail = ''
	/** @type {import('npm:@steve02081504/exec').ExecOptions & object} */
	const execOptions = {
		cwd: repoRoot,
		env: { ...process.env, ...env },
		no_output_record: true,
		/**
		 * @param {string | Uint8Array} data stdout 片段
		 * @returns {void}
		 */
		on_stdout: data => {
			const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
			outputTail = appendBoundedTail(outputTail, text)
			if (stream) process.stdout.write(data)
		},
		/**
		 * @param {string | Uint8Array} data stderr 片段
		 * @returns {void}
		 */
		on_stderr: data => {
			const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
			outputTail = appendBoundedTail(outputTail, text)
			if (stream) process.stderr.write(data)
		},
	}

	const result = await execFile(executable, args, execOptions)
	return { code: result.code ?? 1, output: outputTail }
}

/**
 * 为 live 脚本构造多节点环境变量。
 * @param {import('../node/launch.mjs').LaunchedNode[]} nodes 已启动节点
 * @param {string} repoRoot 仓库根目录
 * @returns {Record<string, string>} 子进程 env
 */
function buildLiveNodeEnv(nodes, repoRoot) {
	/** @type {Record<string, string>} */
	const env = {
		FOUNT_API_KEY: nodes[0].apiKey,
		FOUNT_TEST_BASE_URL: nodes[0].baseUrl,
		FOUNT_TEST_REPO_ROOT: repoRoot,
		FOUNT_TEST_NODE_COUNT: String(nodes.length),
	}
	for (let i = 0; i < nodes.length; i++) {
		const idx = i + 1
		const node = nodes[i]
		env[`FOUNT_TEST_NODE_${idx}_BASE_URL`] = node.baseUrl
		env[`FOUNT_TEST_NODE_${idx}_KEY`] = node.apiKey
		env[`FOUNT_TEST_NODE_${idx}_DATA`] = node.dataPath
		env[`FOUNT_TEST_NODE_${idx}_PORT`] = String(node.port)
	}
	return env
}

/**
 * 联邦 suite 启动后轮询各节点 ping 就绪。
 * @param {import('../node/launch.mjs').LaunchedNode[]} nodes 已启动节点
 * @param {number} [timeoutMs=30000] 超时毫秒
 * @returns {Promise<void>}
 */
async function waitForFedNodesPing(nodes, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const ready = await Promise.all(nodes.map(async node => {
			const res = await fetch(`${node.baseUrl}/api/ping?fount-apikey=${encodeURIComponent(node.apiKey)}`)
			return res.ok && (await res.json())?.message === 'pong'
		}))
		if (ready.every(Boolean)) return
		await new Promise(resolve => { setTimeout(resolve, 500) })
	}
	throw new Error(`federation nodes not ready within ${timeoutMs}ms`)
}

/**
 * 节点 launch 配置工厂上下文。
 * @typedef {object} LiveNodeBuildContext
 * @property {number} port 已分配并持有的端口
 * @property {() => Promise<void>} releasePort spawn 前释放该端口持有
 */

/**
 * 启动节点、运行指定 live suite 并 teardown。
 * 端口按 suite 的 `fedNodes`（或 fed→2 / 单节点→1）即时分配，避免顶层预占 6 口与并行套件互抢。
 * @param {object} options 运行选项
 * @param {string} options.suiteName manifest / suites 中的名称
 * @param {Record<string, { fed?: boolean, fedNodes?: number, run: string[], node?: object }>} options.suites suite 表
 * @param {string} options.repoRoot 仓库根目录
 * @param {(index: number, context: LiveNodeBuildContext) => object} options.buildNode 按节点序号构造 launchNode 选项
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runLiveSuite({
	suiteName,
	suites,
	repoRoot,
	buildNode,
}) {
	const spec = suites[suiteName]
	if (!spec) {
		console.errorI18n('fountConsole.test.unknownSuite', { name: suiteName })
		console.errorI18n('fountConsole.test.available', { ids: Object.keys(suites).join(', ') })
		return 2
	}

	const fedNodeCount = spec.fedNodes ?? (spec.fed ? 2 : 1)
	const { ports, releasePort, releaseAll } = await resolveLiveNodeFleet(fedNodeCount)
	const nodes = []
	const federationCleanup = join(repoRoot, FEDERATION_CLEANUP)
	try {
		for (let i = 0; i < fedNodeCount; i++) {
			const port = ports[i]
			nodes.push(await launchNode({
				...buildNode(i, { port, releasePort: () => releasePort(port) }),
				...spec.node,
			}))
		}

		if (fedNodeCount > 1)
			await waitForFedNodesPing(nodes)

		const env = buildLiveNodeEnv(nodes, repoRoot)

		if (spec.fed) {
			const pre = await runCommand(repoRoot, denoLiveRun(federationCleanup), env)
			if (pre.code !== 0) console.warnI18n('fountConsole.test.federationCleanupPre', { output: pre.output })
		}

		console.logI18n('fountConsole.test.suiteHeader', { name: suiteName })
		const result = await runCommand(repoRoot, spec.run, env, { stream: true })

		if (spec.fed) {
			const post = await runCommand(repoRoot, denoLiveRun(federationCleanup), env)
			if (post.code !== 0) console.warnI18n('fountConsole.test.federationCleanupPost', { output: post.output })
		}

		return result.code
	}
	catch (error) {
		// launch / ping 失败等：必须返回非 0，禁止变成 unhandledRejection 后 exit 0
		console.error(error)
		return 1
	}
	finally {
		for (const node of nodes.reverse())
			await stopNode(node)
		await releaseAll()
	}
}

/**
 * 解析 CLI 参数并运行 live suite（供各 shell test/live/run.mjs 调用）。
 * @param {object} options CLI 配置
 * @param {Record<string, { fed?: boolean, fedNodes?: number, run: string[], node?: object }>} options.suites suite 表
 * @param {string} options.repoRoot 仓库根目录
 * @param {(index: number, context: LiveNodeBuildContext) => object} options.buildNode 节点配置工厂
 * @param {string} [options.defaultSuite] 默认 suite 名
 * @returns {Promise<void>}
 */
export async function runLiveSuiteCli({ suites, repoRoot, buildNode, defaultSuite }) {
	const { values } = parseArgsOrExit({
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
		console.errorI18n('fountConsole.test.liveUsage')
		process.exit(2)
	}

	process.exit(await runLiveSuite({
		suiteName: values.suite,
		suites,
		repoRoot,
		buildNode,
	}))
}
