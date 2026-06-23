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
	const basePort = await resolveFrontendPort(
		process.env.FOUNT_TEST_FRONTEND_PORT,
		() => allocateTestPortBlock({ count: phases.length, step: portStep }),
	)

	/**
	 * 为指定端口构造 launchNode 选项。
	 * @param {number} port 监听端口
	 * @returns {object} launchNode 选项
	 */
	function nodeLaunchOptions(port) {
		return {
			port,
			username: testUsername,
			apiKey: process.env.FOUNT_TEST_FRONTEND_KEY || `${apiKeyPrefix}-${port}`,
			loadParts,
			p2p: true,
			bootstrap: bootstrapPath,
		}
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
	})
}
