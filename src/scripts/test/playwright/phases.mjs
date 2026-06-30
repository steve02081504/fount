/**
 * 多阶段 Playwright 前端测试 driver 共用逻辑。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { console } from '../../i18n.mjs'
import {
	isIncludedInTestOnly,
	parseTestOnlyEnv,
	toRepoRelative,
	writeFailuresOutFile,
} from '../core/protocol.mjs'

import { failedSpecPathsFromJsonReport } from './report.mjs'
import { runPlaywrightWithNode } from './run.mjs'

/**
 * 多阶段前端测试的单阶段定义。
 * @typedef {object} FrontendPhase
 * @property {string} project Playwright project 名
 * @property {number} portOffset 相对基准端口偏移
 * @property {string[]} specPaths 仓库相对 spec 路径
 * @property {string[]} specBasenames spec 文件名（传给 playwright CLI）
 */

/**
 * 从与 playwright.config.mjs 同目录的 phases.mjs 读取多阶段定义。
 *
 * phases.mjs 是纯数据文件（无 npm 依赖），可在 Deno 和 Node 下双重导入。
 * playwright.config.mjs 本身只在 Node/Playwright 进程中运行，Deno 不应直接导入它。
 * @param {string} configPath playwright.config.mjs 绝对路径（用于定位同目录的 phases.mjs）
 * @param {string} repoRoot 仓库根
 * @param {{ portStep?: number }} [options] 端口步长选项
 * @returns {Promise<FrontendPhase[]>} 阶段列表
 */
export async function phasesFromPlaywrightConfig(configPath, repoRoot, { portStep = 2 } = {}) {
	const phasesPath = join(dirname(configPath), 'phases.mjs')
	const { phases } = await import(pathToFileURL(resolve(phasesPath)).href)
	const testDir = dirname(configPath)

	return phases.map((phase, index) => {
		const patterns = Array.isArray(phase.testMatch) ? phase.testMatch : [phase.testMatch]
		const specBasenames = patterns.map(pattern => pattern.replace(/^\*\//, ''))
		const specPaths = specBasenames.map(name => toRepoRelative(repoRoot, join(testDir, name)))
		return {
			project: phase.name,
			portOffset: index * portStep,
			specPaths,
			specBasenames,
		}
	})
}

/**
 * 按 FOUNT_TEST_ONLY 过滤前端测试阶段。
 * @param {string[]} filterList FOUNT_TEST_ONLY 列表
 * @param {FrontendPhase[]} phases 全部阶段
 * @param {string} repoRoot 仓库根
 * @returns {FrontendPhase[]} 匹配的阶段
 */
export function filterPhases(filterList, phases, repoRoot) {
	if (!filterList.length) return phases
	return phases.filter(phase =>
		phase.specPaths.some(path => isIncludedInTestOnly(repoRoot, path, filterList)),
	)
}

/**
 * 收集阶段内应记入失败列表的 spec 路径。
 * @param {object} params 参数
 * @param {string} params.jsonReportPath Playwright JSON report 路径
 * @param {string} params.repoRoot 仓库根
 * @param {FrontendPhase} params.phase 当前阶段
 * @param {string[]} params.ranSpecPaths 本阶段实际执行的 spec 仓库相对路径
 * @returns {Promise<string[]>} 失败 spec 仓库相对路径
 */
async function collectPhaseFailures({ jsonReportPath, repoRoot, ranSpecPaths }) {
	const paths = await failedSpecPathsFromJsonReport(jsonReportPath, repoRoot)
	if (paths.length)
		return paths
	return ranSpecPaths
}

/**
 * 按阶段运行 Playwright，支持失败收集与仅重跑失败 spec。
 * @param {object} options 选项
 * @param {string} options.configPath playwright.config.mjs
 * @param {string} options.repoRoot 仓库根
 * @param {number} options.basePort 基准端口
 * @param {FrontendPhase[]} options.phases 阶段列表
 * @param {Record<string, string>} options.env 环境变量
 * @param {(port: number) => object} options.nodeOpts launchNode 选项工厂
 * @param {string} [options.extraArgs] 额外 playwright 参数
 * @returns {Promise<number>} 退出码
 */
export async function runFrontendPhases({
	configPath,
	repoRoot,
	basePort,
	phases,
	env,
	nodeOpts,
	extraArgs = '',
}) {
	const jsonReportDir = await mkdtemp(join(tmpdir(), 'fount-pw-json-'))
	const filterList = parseTestOnlyEnv()
	const selected = filterPhases(filterList, phases, repoRoot)
	const keepGoing = process.env.FOUNT_TEST_KEEP_GOING === '1'

	if (!selected.length) {
		console.errorI18n('fountConsole.test.noFrontendPhasesMatched')
		return 2
	}

	const failed = []

	try {
		for (const phase of selected) {
			const port = basePort + phase.portOffset
			let playwrightArgs = [extraArgs, `--project=${phase.project}`].filter(Boolean)
			let ranSpecPaths = phase.specPaths

			if (filterList.length) {
				const phaseOnly = phase.specBasenames.filter((_, index) =>
					isIncludedInTestOnly(repoRoot, phase.specPaths[index], filterList),
				)
				if (!phaseOnly.length) continue
				ranSpecPaths = phase.specPaths.filter((_, index) =>
					isIncludedInTestOnly(repoRoot, phase.specPaths[index], filterList),
				)
				playwrightArgs = [extraArgs, ...phaseOnly].filter(Boolean)
			}

			const jsonReportPath = join(jsonReportDir, `${phase.project}.json`)
			const code = await runPlaywrightWithNode({
				configPath,
				playwrightArgs: playwrightArgs.join(' '),
				env,
				node: nodeOpts(port),
				jsonReportPath,
			})
			if (code !== 0) {
				failed.push(...await collectPhaseFailures({
					jsonReportPath,
					repoRoot,
					ranSpecPaths,
				}))

				if (!keepGoing) {
					await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
					return code
				}
			}
		}
	}
	finally {
		await rm(jsonReportDir, { recursive: true, force: true })
	}

	if (failed.length) {
		await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
		return 1
	}
	return 0
}
