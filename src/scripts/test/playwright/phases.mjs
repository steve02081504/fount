/**
 * 多阶段 Playwright 前端测试 driver 共用逻辑。
 *
 * FOUNT_TEST_SUBTESTS：只跑指定子测试（按 spec basename / 子测试名映射）。
 * FOUNT_TEST_FIRST：失败 spec 优先；失败组有复现则跑完失败组即退。
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { console } from '../../i18n/bare.mjs'
import {
	isIncludedInTestOnly,
	orderFailedFirst,
	parseTestFirstEnv,
	parseTestOnlyEnv,
	parseTestSubtestsEnv,
	toRepoRelative,
	writeFailuresOutFile,
	writeTimingsOutFile,
} from '../core/protocol.mjs'
import { markTempDirOrigin } from '../core/temp_origin.mjs'

import { failedSpecPathsFromJsonReport, specTimingsFromJsonReport } from './report.mjs'
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
 * @param {string} configPath playwright.config.mjs 绝对路径
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
 * 子测试名是否匹配 spec（name 或 name.spec.mjs）。
 * @param {string} subtestName 子测试名
 * @param {string} specBasename spec 文件名
 * @returns {boolean} 是否匹配
 */
export function subtestMatchesSpec(subtestName, specBasename) {
	if (subtestName === specBasename) return true
	if (specBasename === `${subtestName}.spec.mjs`) return true
	const stem = specBasename.replace(/\.spec\.mjs$/, '')
	return stem === subtestName
}

/**
 * 无阶段 Playwright driver：把 `FOUNT_TEST_SUBTESTS` 收成 spec 文件名 argv。
 * @param {string[]} specBasenames 目录内 `*.spec.mjs`
 * @param {string[]} [extraArgs] 额外 playwright argv（在 spec 之前）
 * @returns {string[]} playwright argv
 */
export function playwrightArgsForSubtests(specBasenames, extraArgs = []) {
	const subtests = parseTestSubtestsEnv()
	if (!subtests.length) return extraArgs
	const specs = specBasenames.filter(name => subtests.some(st => subtestMatchesSpec(st, name)))
	if (!specs.length)
		throw new Error(`FOUNT_TEST_SUBTESTS=${subtests.join(',')} matched no spec in ${specBasenames.join(', ')}`)
	return [...extraArgs, ...specs]
}

/**
 * 按 FOUNT_TEST_ONLY / FOUNT_TEST_SUBTESTS 过滤阶段内 spec。
 * @param {FrontendPhase[]} phases 全部阶段
 * @param {string} repoRoot 仓库根
 * @param {string[]} filterList FOUNT_TEST_ONLY
 * @param {string[]} subtestList FOUNT_TEST_SUBTESTS
 * @returns {FrontendPhase[]} 过滤后阶段（可能去掉空阶段）
 */
export function filterPhasesBySelection(phases, repoRoot, filterList, subtestList) {
	return phases.map(phase => {
		/** @type {number[]} */
		const keep = []
		for (let index = 0; index < phase.specPaths.length; index++) {
			const path = phase.specPaths[index]
			const basename = phase.specBasenames[index]
			if (filterList.length && !isIncludedInTestOnly(repoRoot, path, filterList))
				continue
			if (subtestList.length && !subtestList.some(name => subtestMatchesSpec(name, basename)))
				continue
			keep.push(index)
		}
		if (!keep.length) return null
		return {
			project: phase.project,
			portOffset: phase.portOffset,
			specPaths: keep.map(index => phase.specPaths[index]),
			specBasenames: keep.map(index => phase.specBasenames[index]),
		}
	}).filter(Boolean)
}

/**
 * 收集阶段内应记入失败列表的 spec 路径。
 * @param {object} params 参数
 * @param {string} params.jsonReportPath Playwright JSON report 路径
 * @param {string} params.repoRoot 仓库根
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
 * 跑单个 phase 的选定 spec。
 * @param {object} params 参数
 * @param {FrontendPhase} params.phase 阶段
 * @param {string[]} params.specBasenames 要跑的 spec 文件名
 * @param {string[]} params.specPaths 对应仓库相对路径
 * @param {string} params.configPath playwright 配置路径
 * @param {number} params.basePort 基准端口
 * @param {Record<string, string>} params.env 环境变量
 * @param {(port: number) => object} params.nodeOpts 节点选项工厂
 * @param {string | string[]} params.extraArgs 额外 CLI 参数（数组保留 token 边界）
 * @param {string} params.jsonReportDir JSON report 目录
 * @param {number} params.reportIndex 本次运行内的 report 序号（文件名用短序号，spec 名拼接会超 Windows MAX_PATH）
 * @param {string} params.repoRoot 仓库根
 * @returns {Promise<{ code: number, failed: string[], timings: Record<string, number> }>} 结果
 */
async function runOnePhase({
	phase,
	specBasenames,
	specPaths,
	configPath,
	basePort,
	env,
	nodeOpts,
	extraArgs,
	jsonReportDir,
	reportIndex,
	repoRoot,
}) {
	if (!specBasenames.length) return { code: 0, failed: [], timings: {} }
	const port = basePort + phase.portOffset
	const playwrightArgs = [
		...Array.isArray(extraArgs)
			? extraArgs
			: extraArgs?.trim() ? extraArgs.trim().split(/\s+/) : [],
		`--project=${phase.project}`,
		...specBasenames,
	].filter(Boolean)
	const jsonReportPath = join(jsonReportDir, `${phase.project}-${reportIndex}.json`)
	const code = await runPlaywrightWithNode({
		configPath,
		playwrightArgs,
		env,
		node: nodeOpts(port),
		jsonReportPath,
	})
	const timings = await specTimingsFromJsonReport(jsonReportPath, repoRoot)
	if (code === 0) return { code: 0, failed: [], timings }
	return {
		code,
		failed: await collectPhaseFailures({ jsonReportPath, repoRoot, ranSpecPaths: specPaths }),
		timings,
	}
}

/**
 * 按阶段运行 Playwright，支持失败优先与子测试子集。
 * @param {object} options 选项
 * @param {string} options.configPath playwright.config.mjs
 * @param {string} options.repoRoot 仓库根
 * @param {number} options.basePort 基准端口
 * @param {FrontendPhase[]} options.phases 阶段列表
 * @param {Record<string, string>} options.env 环境变量
 * @param {(port: number) => object} options.nodeOpts launchNode 选项工厂
 * @param {string | string[]} [options.extraArgs] 额外 playwright 参数（数组保留 token 边界）
 * @param {string[]} [options.failFastProjects] 失败即停的 project 名（默认 shell/smoke）
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
	failFastProjects = ['shell', 'smoke'],
}) {
	// 放 data/test 而非系统 Temp：长相位期间 Temp 清理可能删掉 report，整个 phase 结果即丢。
	const jsonReportDir = await mkdtemp(join(repoRoot, 'data', 'test', 'fount-pw-json-'))
	await markTempDirOrigin(jsonReportDir, 'playwright phases jsonReportDir')
	const filterList = parseTestOnlyEnv()
	const subtestList = parseTestSubtestsEnv()
	const firstList = parseTestFirstEnv()
	const keepGoing = process.env.FOUNT_TEST_KEEP_GOING === '1'
	const selected = filterPhasesBySelection(phases, repoRoot, filterList, subtestList)
	const failFastSet = new Set(failFastProjects)

	if (!selected.length) {
		console.errorI18n('fountConsole.test.noFrontendPhasesMatched')
		return 2
	}

	/** @type {string[]} */
	const allSpecPaths = selected.flatMap(phase => phase.specPaths)
	const { first: firstPaths, rest: restPaths } = orderFailedFirst(allSpecPaths, firstList)
	const firstSet = new Set(firstPaths)
	const restSet = new Set(restPaths)
	const failed = []
	/** @type {Record<string, number>} */
	const timings = {}
	let reportSeq = 0

	/**
	 * 按 phase 顺序跑给定 path 集合中的 spec。
	 * @param {Set<string>} pathSet 要跑的路径
	 * @param {{ abortOnPhaseFail: boolean }} opts 选项
	 * @returns {Promise<number>} 若需中止则返回非 0
	 */
	async function runPathSet(pathSet, { abortOnPhaseFail }) {
		for (const phase of selected) {
			const indexes = phase.specPaths
				.map((path, index) => pathSet.has(path) ? index : -1)
				.filter(index => index >= 0)
			if (!indexes.length) continue
			// report 目录可能在相位间隙被外部移除：playwright 子进程写 JSON report 前必须保证存在。
			await mkdir(jsonReportDir, { recursive: true })
			const specBasenames = indexes.map(index => phase.specBasenames[index])
			const specPaths = indexes.map(index => phase.specPaths[index])
			const { code, failed: phaseFailed, timings: phaseTimings } = await runOnePhase({
				phase,
				specBasenames,
				specPaths,
				configPath,
				basePort,
				env,
				nodeOpts,
				extraArgs,
				jsonReportDir,
				reportIndex: ++reportSeq,
				repoRoot,
			})
			Object.assign(timings, phaseTimings)
			if (code !== 0) {
				failed.push(...phaseFailed)
				const failFast = failFastSet.has(phase.project)
				if (abortOnPhaseFail || failFast || !keepGoing) return code
			}
		}
		return 0
	}

	try {
		if (firstSet.size) {
			// 失败组：各 phase 内失败 spec 跑完；组内有失败则直接退
			const code = await runPathSet(firstSet, { abortOnPhaseFail: false })
			if (failed.length || code !== 0) {
				await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed.length ? failed : [...firstSet])
				await writeTimingsOutFile(process.env.FOUNT_TEST_TIMINGS_OUT, timings)
				return code || 1
			}
		}

		if (restSet.size) {
			const code = await runPathSet(restSet, { abortOnPhaseFail: !keepGoing })
			if (failed.length) {
				await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
				await writeTimingsOutFile(process.env.FOUNT_TEST_TIMINGS_OUT, timings)
				return code || 1
			}
			if (code !== 0) {
				await writeTimingsOutFile(process.env.FOUNT_TEST_TIMINGS_OUT, timings)
				return code
			}
		}

		await writeTimingsOutFile(process.env.FOUNT_TEST_TIMINGS_OUT, timings)
	}
	finally {
		await rm(jsonReportDir, { recursive: true, force: true })
	}

	return 0
}
