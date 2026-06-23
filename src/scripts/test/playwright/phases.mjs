/**
 * 多阶段 Playwright 前端测试 driver 共用逻辑。
 */
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
	isIncludedInTestOnly,
	parseTestOnlyEnv,
	toRepoRelative,
	writeFailuresOutFile,
} from '../core/protocol.mjs'

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
 * 从 playwright.config.mjs 派生多阶段定义。
 * @param {string} configPath playwright.config.mjs 绝对路径
 * @param {string} repoRoot 仓库根
 * @param {{ portStep?: number }} [options] 端口步长选项
 * @returns {Promise<FrontendPhase[]>} 阶段列表
 */
export async function phasesFromPlaywrightConfig(configPath, repoRoot, { portStep = 2 } = {}) {
	const config = (await import(pathToFileURL(resolve(configPath)).href)).default
	const testDir = resolve(dirname(configPath), config.testDir ?? '.')
	const projects = config.projects ?? [{ name: 'default' }]

	return projects.map((project, index) => {
		const patterns = project.testMatch
			? Array.isArray(project.testMatch) ? project.testMatch : [project.testMatch]
			: ['*.spec.mjs']
		const specBasenames = patterns.map(pattern => pattern.replace(/^\*\//, ''))
		const specPaths = specBasenames.map(name => toRepoRelative(repoRoot, join(testDir, name)))
		return {
			project: project.name,
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
	const filterList = parseTestOnlyEnv()
	const selected = filterPhases(filterList, phases, repoRoot)
	const keepGoing = process.env.FOUNT_TEST_KEEP_GOING === '1'

	if (!selected.length) {
		console.error('no frontend phases matched FOUNT_TEST_ONLY')
		return 2
	}

	const failed = []

	for (const phase of selected) {
		const port = basePort + phase.portOffset
		let playwrightArgs = [extraArgs, `--project=${phase.project}`].filter(Boolean)

		if (filterList.length) {
			const phaseOnly = phase.specBasenames.filter((_, index) =>
				isIncludedInTestOnly(repoRoot, phase.specPaths[index], filterList),
			)
			if (!phaseOnly.length) continue
			playwrightArgs = [extraArgs, ...phaseOnly].filter(Boolean)
		}

		const code = await runPlaywrightWithNode({
			configPath,
			playwrightArgs: playwrightArgs.join(' '),
			env,
			node: nodeOpts(port),
		})
		if (code !== 0) {
			if (filterList.length)
				failed.push(...phase.specPaths.filter(path => isIncludedInTestOnly(repoRoot, path, filterList)))
			else
				failed.push(...phase.specPaths)

			if (!keepGoing) {
				await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
				return code
			}
		}
	}

	if (failed.length) {
		await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
		return 1
	}
	return 0
}
