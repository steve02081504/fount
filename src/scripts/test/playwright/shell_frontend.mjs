/**
 * Shell 前端 Playwright 多阶段 driver。
 */
import process from 'node:process'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { allocateTestPortBlock } from '../node/launch.mjs'

import { resolveFrontendPort } from './env.mjs'
import { phasesFromPlaywrightConfig, runFrontendPhases } from './phases.mjs'

/**
 * 运行 shell 前端多阶段 Playwright 测试。
 * @param {object} options 运行选项
 * @param {string} options.configPath playwright.config.mjs 绝对路径
 * @param {string} options.testUsername 隔离测试用户名
 * @param {string} options.apiKeyPrefix API key 前缀（后接 -{port}）
 * @param {string[]} options.loadParts 启动时 load 的 part
 * @param {string} options.bootstrapPath bootstrap 模块绝对路径
 * @param {number} [options.portStep=2] 阶段间端口步长
 * @returns {Promise<number>} 进程退出码
 */
export async function runShellFrontendTests({
	configPath,
	testUsername,
	apiKeyPrefix,
	loadParts,
	bootstrapPath,
	portStep = 2,
}) {
	const phases = await phasesFromPlaywrightConfig(configPath, REPO_ROOT, { portStep })

	let basePort
	/** @type {((port: number) => Promise<void>) | null} */
	let releasePortForPhase = null
	/** @type {((port: number) => Promise<void>) | null} */
	let commitPortForPhase = null
	const { env: { FOUNT_TEST_FRONTEND_PORT: rawFrontendPort, FOUNT_TEST_FRONTEND_KEY: frontendApiKey } } = process
	if (rawFrontendPort != null && rawFrontendPort !== '') 
		basePort = await resolveFrontendPort(rawFrontendPort, async () => {
			throw new Error('FOUNT_TEST_FRONTEND_PORT fallback should not run')
		})
	
	else {
		const { base, releasePort, commitPort } = await allocateTestPortBlock({ count: phases.length, step: portStep })
		basePort = base
		releasePortForPhase = releasePort
		commitPortForPhase = commitPort
	}

	/**
	 * 为指定端口构造 launchNode 选项。
	 * @param {number} port 监听端口
	 * @returns {object} launchNode 选项
	 */
	function nodeLaunchOptions(port) {
		const opts = {
			port,
			username: testUsername,
			apiKey: frontendApiKey || `${apiKeyPrefix}-${port}`,
			loadParts,
			p2p: true,
			bootstrap: bootstrapPath,
		}
		if (releasePortForPhase) {
			/**
			 * spawn 前释放该阶段端口的 listen hold。
			 * @returns {Promise<void>}
			 */
			function releaseHeldPort() {
				return releasePortForPhase(port)
			}
			/**
			 * 子进程就绪后释放跨进程租约。
			 * @returns {Promise<void>}
			 */
			function commitHeldPort() {
				return commitPortForPhase(port)
			}
			opts.releasePort = releaseHeldPort
			opts.commitPort = commitHeldPort
		}
		return opts
	}

	return runFrontendPhases({
		configPath,
		repoRoot: REPO_ROOT,
		basePort,
		phases,
		env: {
			FOUNT_TEST_ISOLATED: '1',
			FOUNT_TEST_USERNAME: testUsername,
		},
		nodeOpts: nodeLaunchOptions,
		extraArgs: process.argv.slice(2).join(' '),
		failFastProjects: ['shell', 'smoke'],
	})
}
