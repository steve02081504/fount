/**
 * Playwright E2E 运行器（Deno driver；@playwright/test 引擎仍须在 Node 子进程运行）。
 *
 *   import { runPlaywrightWithNode } from './playwright_run.mjs'
 *   process.exit(await runPlaywrightWithNode({ configPath, node: { port: 8941 } }))
 */
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { exec } from 'npm:@steve02081504/exec'
import 'npm:@playwright/test'

import { launchNode, stopNode } from './launch_node.mjs'

const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

/**
 * 运行 Playwright 测试套件。
 * @param {object} opts 运行选项
 * @param {string} opts.configPath playwright.config.mjs 路径
 * @param {string} [opts.cwd=REPO_ROOT] 工作目录
 * @param {Record<string, string>} [opts.env] 额外环境变量
 * @param {string} [opts.playwrightArgs=''] 传给 playwright test 的额外参数
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runPlaywright({ configPath, cwd = REPO_ROOT, env = {}, playwrightArgs = '' }) {
	const out = await exec(`npx playwright test -c ${JSON.stringify(configPath)} ${playwrightArgs}`.trim(), {
		cwd,
		env: { ...process.env, ...env },
		no_output_record: true,
		/**
		 * @param {string | Uint8Array} data - 标准输出片段。
		 * @returns {void}
		 */
		on_stdout: data => process.stdout.write(data),
		/**
		 * @param {string | Uint8Array} data - 标准错误片段。
		 * @returns {void}
		 */
		on_stderr: data => process.stderr.write(data),
	})
	return out.code ?? 1
}

/**
 * 可选自启 fount 节点后运行 Playwright。
 * @param {object} opts 运行选项
 * @param {string} opts.configPath playwright.config.mjs 路径
 * @param {object} [opts.node] launchNode 选项（port、username、apiKey 等）
 * @param {Record<string, string>} [opts.env] 额外环境变量
 * @param {string} [opts.cwd] 工作目录
 * @param {string} [opts.playwrightArgs=''] 传给 playwright test 的额外参数
 * @returns {Promise<number>} 进程退出码
 */
export async function runPlaywrightWithNode({ configPath, node, env: extraEnv = {}, cwd, playwrightArgs = '' }) {
	/** @type {Awaited<ReturnType<typeof launchNode>> | null} */
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
