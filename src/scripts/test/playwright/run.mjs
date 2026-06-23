import { createRequire } from 'node:module'
import process from 'node:process'

import { exec } from 'npm:@steve02081504/exec'
import 'npm:@playwright/test'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { launchNode, stopNode } from '../node/launch.mjs'

const require = createRequire(import.meta.url)
const playwrightCli = require.resolve('@playwright/test/cli')

/**
 * 运行 Playwright 测试套件。
 * @param {object} options 运行选项
 * @param {string} options.configPath playwright.config.mjs 路径
 * @param {string} [options.cwd=REPO_ROOT] 工作目录
 * @param {Record<string, string>} [options.env] 额外环境变量
 * @param {string} [options.playwrightArgs=''] 传给 playwright test 的额外参数
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runPlaywright({ configPath, cwd = REPO_ROOT, env = {}, playwrightArgs = '' }) {
	const output = await exec(`node ${JSON.stringify(playwrightCli)} test -c ${JSON.stringify(configPath)} ${playwrightArgs}`.trim(), {
		cwd,
		env: { ...process.env, ...env },
		no_output_record: true,
		/**
		 * 转发子进程标准输出。
		 * @param {string | Uint8Array} data 标准输出片段
		 * @returns {void}
		 */
		on_stdout: data => process.stdout.write(data),
		/**
		 * 转发子进程标准错误。
		 * @param {string | Uint8Array} data 标准错误片段
		 * @returns {void}
		 */
		on_stderr: data => process.stderr.write(data),
	})
	return output.code ?? 1
}

/**
 * 可选自启 fount 节点后运行 Playwright。
 * @param {object} options 运行选项
 * @param {string} options.configPath playwright.config.mjs 路径
 * @param {object} [options.node] launchNode 选项（port、username、apiKey 等）
 * @param {Record<string, string>} [options.env] 额外环境变量
 * @param {string} [options.cwd] 工作目录
 * @param {string} [options.playwrightArgs=''] 传给 playwright test 的额外参数
 * @returns {Promise<number>} 进程退出码
 */
export async function runPlaywrightWithNode({ configPath, node, env: extraEnv = {}, cwd, playwrightArgs = '' }) {
	let launched = null
	try {
		const env = { ...process.env, ...extraEnv }
		if (node) {
			launched = await launchNode(node)
			env.FOUNT_TEST_BASE_URL = launched.baseUrl
			env.FOUNT_API_KEY = launched.apiKey
		}
		return await runPlaywright({ configPath, cwd, env, playwrightArgs })
	}
	finally {
		if (launched) await stopNode(launched)
	}
}
