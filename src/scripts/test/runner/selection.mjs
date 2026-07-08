import { console } from '../../i18n/bare.mjs'
import { collectChangesSinceRecord } from '../core/changed.mjs'
import {
	expandWithDependencies,
	expandWithDependents,
	listImperfectSuites,
	listOutdatedSuites,
} from '../core/deps.mjs'
import { filterSuites, listManifestIds, resolveManifestSelectors, selectSuitesByDiff } from '../core/manifest.mjs'
import {
	suiteKey,
} from '../core/state.mjs'

import {
	buildContinueReasonsForSuites,
	pendingContinueReason,
	stampExpansionReasons,
} from './continue_reason.mjs'
import { RunReportWriter } from './report.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').TestState} TestState
 */

/**
 * @typedef {object} SuiteSelection
 * @property {'run' | 'exit'} action
 * @property {number} [code]
 * @property {SuiteDef[]} [suites]
 * @property {Map<string, Map<string, string[] | undefined>>} [retryByManifest]
 * @property {RunReportWriter} [reportWriter]
 * @property {'normal' | 'continue-pending' | 'continue-imperfect' | 'outdated'} [mode]
 * @property {Map<string, import('./continue_reason.mjs').ContinueReason>} [continueReasons]
 */

/**
 * @param {SuiteDef[]} suites 候选 suite
 * @returns {SuiteDef[]} 去重后的 suite
 */
function dedupeSuites(suites) {
	const map = new Map()
	for (const suite of suites)
		map.set(suiteKey(suite.manifestId, suite.name), suite)
	return [...map.values()]
}

/**
 * @param {TestState} state 现状库
 * @param {string[] | undefined} manifestIds manifest 范围
 * @returns {Map<string, Map<string, string[] | undefined>>} manifest -> suite -> 失败文件
 */
function buildRetryByManifest(state, manifestIds) {
	/** @type {Map<string, Map<string, string[] | undefined>>} */
	const retryByManifest = new Map()
	for (const [key, entry] of Object.entries(state.suites)) {
		if (entry.status !== 'failed' && entry.status !== 'noisy') continue
		const slash = key.indexOf('/')
		const manifestId = key.slice(0, slash)
		if (manifestIds?.length && !manifestIds.includes(manifestId)) continue
		const name = key.slice(slash + 1)
		const map = retryByManifest.get(manifestId) ?? new Map()
		map.set(name, entry.failedFiles?.length ? entry.failedFiles : undefined)
		retryByManifest.set(manifestId, map)
	}
	return retryByManifest
}

/**
 * @param {SuiteDef[]} candidates 候选
 * @param {Map<string, Map<string, string[] | undefined>>} retryByManifest 重跑映射
 * @returns {SuiteDef[]} 待重跑 suite
 */
function suitesFromFailureRetry(candidates, retryByManifest) {
	const retryManifestIds = [...retryByManifest.keys()]
	const allowedSuites = new Set([...retryByManifest.values()].flatMap(map => [...map.keys()]))
	return candidates.filter(suite =>
		retryManifestIds.includes(suite.manifestId) && allowedSuites.has(suite.name),
	)
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @returns {Promise<Map<string, string[]>>} suite 键 -> 自记录 commit 以来变更文件
 */
export async function buildChangedSinceRecordMap(repoRoot, allSuites, state) {
	/** @type {Map<string, string[]>} */
	const map = new Map()
	await Promise.all(allSuites.map(async suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		map.set(key, await collectChangesSinceRecord(repoRoot, entry?.commitHash ?? null, []))
	}))
	return map
}

/**
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {TestState} params.state 现状库
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} params.changedSinceRecordByKey 变更映射
 * @returns {Promise<SuiteSelection>} 选择结果
 */
export async function selectContinue({
	repoRoot,
	allSuites,
	state,
	commitHash,
	uncommittedHash,
	changedSinceRecordByKey,
}) {
	const resumed = await RunReportWriter.resume(repoRoot)
	if (resumed?.pendingSlots.length) {
		const pendingRuns = resumed.pendingSlots
			.map(pending => ({
				suite: allSuites.find(s => s.manifestId === pending.manifestId && s.name === pending.name),
				index: pending.index,
			}))
			.filter(item => item.suite)
			.sort((a, b) => a.index - b.index)
		if (pendingRuns.length) {
			/** @type {Map<string, import('./continue_reason.mjs').ContinueReason>} */
			const continueReasons = new Map()
			for (const item of pendingRuns)
				continueReasons.set(suiteKey(item.suite.manifestId, item.suite.name), pendingContinueReason())
			return {
				action: 'run',
				mode: 'continue-pending',
				suites: pendingRuns.map(item => item.suite),
				reportWriter: resumed,
				retryByManifest: new Map(),
				continueReasons,
			}
		}
	}

	const imperfect = listImperfectSuites(allSuites, state, commitHash, uncommittedHash, changedSinceRecordByKey)
	if (imperfect.length)
		return {
			action: 'run',
			mode: 'continue-imperfect',
			suites: imperfect,
			retryByManifest: buildRetryByManifest(state),
			continueReasons: buildContinueReasonsForSuites(
				imperfect, state, commitHash, uncommittedHash, changedSinceRecordByKey,
			),
		}

	return { action: 'exit', code: 0 }
}

/**
 * @param {object} params 参数
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {TestState} params.state 现状库
 * @param {SuiteDef[]} [params.filtered] 过滤范围
 * @param {Map<string, string[]>} params.changedSinceRecordByKey 变更映射
 * @returns {SuiteSelection} 选择结果
 */
export function selectOutdated({
	allSuites,
	state,
	filtered,
	changedSinceRecordByKey,
}) {
	const scope = filtered ?? allSuites
	const outdated = listOutdatedSuites(scope, state, changedSinceRecordByKey)
	return {
		action: 'run',
		mode: 'outdated',
		suites: outdated,
		retryByManifest: new Map(),
	}
}

/**
 * @param {object} params 选择参数
 * @param {string} params.repoRoot 仓库根
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {SuiteDef[]} params.filtered manifest/suite 过滤后
 * @param {{ mode: string, files: string[] }} params.changed 变更文件解析结果
 * @param {boolean} params.runAll 是否全量
 * @param {string[]} [params.manifestIds] manifest id 列表
 * @param {boolean} [params.explicitSuites] 是否显式指名 suite
 * @param {string} params.commitHash 当前 HEAD
 * @param {string | null} params.uncommittedHash 当前未提交 digest
 * @param {string[]} params.uncommittedFiles 未提交路径列表
 * @param {TestState} params.state 现状库
 * @param {Map<string, string[]>} params.changedSinceRecordByKey 变更映射
 * @returns {Promise<SuiteSelection>} 选择结果
 */
export async function selectSuites({
	repoRoot,
	allSuites,
	filtered,
	changed,
	runAll,
	manifestIds,
	explicitSuites,
	commitHash,
	uncommittedHash,
	uncommittedFiles,
	state,
	changedSinceRecordByKey,
}) {
	if (runAll || explicitSuites)
		return {
			action: 'run',
			mode: 'normal',
			suites: filtered,
			retryByManifest: buildRetryByManifest(state, manifestIds),
		}

	const retryByManifest = buildRetryByManifest(state, manifestIds)
	const usingFailureRetry = retryByManifest.size > 0
	let selected = filtered

	if (usingFailureRetry) {
		selected = suitesFromFailureRetry(filtered, retryByManifest)
		console.logI18n('fountConsole.test.failureRetry', {
			manifests: [...retryByManifest.keys()].join(', '),
			count: selected.length,
		})

		const hashStale = uncommittedFiles.length > 0 && [...retryByManifest.keys()].some(manifestId => {
			for (const [key, entry] of Object.entries(state.suites)) {
				if (!key.startsWith(`${manifestId}/`)) continue
				if (entry.uncommittedHash == null || entry.uncommittedHash !== uncommittedHash) return true
			}
			return false
		})
		if (hashStale && changed.mode === 'diff' && changed.files.length) {
			const merged = dedupeSuites([...selected, ...selectSuitesByDiff(changed.mode, changed.files, filtered)])
			console.logI18n('fountConsole.test.hashStaleAppendDiff', {
				count: merged.length - selected.length,
			})
			selected = merged
		}
	}
	else if (changed.mode === 'diff' && changed.files.length) {
		selected = selectSuitesByDiff(changed.mode, changed.files, filtered)
		console.logI18n('fountConsole.test.diffMode', {
			fileCount: changed.files.length,
			files: changed.files.slice(0, 12).join(', ')
				+ (changed.files.length > 12 ? '...' : ''),
		})
	}
	else if (changed.mode === 'none' && !manifestIds?.length) {
		console.logI18n('fountConsole.test.noChangesHint')
		console.logI18n('fountConsole.test.tip')
		if (!usingFailureRetry) return { action: 'exit', code: 0 }
		selected = suitesFromFailureRetry(allSuites, retryByManifest)
		if (!selected.length) return { action: 'exit', code: 0 }
	}
	else if (changed.mode === 'none' && manifestIds?.length)
		console.logI18n('fountConsole.test.manifestNoDiffRunAll', {
			manifestIds: manifestIds.join(','),
		})

	return {
		action: 'run',
		mode: 'normal',
		suites: selected,
		retryByManifest,
	}
}

/**
 * 从 report 命令摘要解析初选 suite。
 * @param {string} command 命令摘要
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {{ seedSuites: SuiteDef[], explicitSuites: boolean }} 初选与是否显式指名
 */
export function parseCommandSeedSuites(command, allSuites) {
	/** @type {{ manifestSelectors: string[], suiteSelectors: string[] }[]} */
	const groups = []
	for (const token of command.trim().split(/\s+/)) {
		if (token === 'fount' || token === 'test' || token.startsWith('--')) continue
		if (token.includes(':')) {
			const colon = token.indexOf(':')
			groups.push({
				manifestSelectors: [token.slice(0, colon)],
				suiteSelectors: token.slice(colon + 1).split(',').filter(Boolean),
			})
		}
		else
			groups.push({ manifestSelectors: [token], suiteSelectors: [] })
	}
	if (!groups.length)
		return { seedSuites: [], explicitSuites: false }

	const knownIds = listManifestIds(allSuites)
	/** @type {SuiteDef[]} */
	const seedSuites = []
	const explicitSuites = groups.some(g => g.suiteSelectors.length > 0)
	for (const group of groups) {
		const resolved = resolveManifestSelectors(group.manifestSelectors, knownIds, allSuites)
		for (const suite of filterSuites(allSuites, {
			manifestIds: resolved.manifestIds,
			suiteSelectors: group.suiteSelectors.length ? group.suiteSelectors : undefined,
		}))
			seedSuites.push(suite)
	}
	return { seedSuites, explicitSuites }
}

/**
 * 为报告内全部槽位重算扩展 provenance 与触发原因。
 * @param {object} params 参数
 * @param {string} params.command 命令摘要
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {SuiteDef[]} params.slots 报告槽位对应 suite
 * @param {TestState} params.state 现状库
 * @param {object} params.ctx 依赖扩展上下文
 * @returns {{ provenance: Map<string, string>, seedKeys: Set<string>, explicitSuites: boolean, reasons: Map<string, import('./continue_reason.mjs').ContinueReason> }} 重算结果
 */
export function rebuildReportSlotReasons({ command, allSuites, slots, state, ctx }) {
	const { seedSuites, explicitSuites } = parseCommandSeedSuites(command, allSuites)
	const seedKeys = new Set(seedSuites.map(s => suiteKey(s.manifestId, s.name)))
	// 续跑（`fount test --continue`）持久化的命令不含显式种子，此时 provenance 无从谈起，
	// 报告槽位应保留既有的续跑原因（pending / imperfect 等），无需按依赖链重标。
	if (!seedKeys.size)
		return { provenance: new Map(), seedKeys, explicitSuites, reasons: new Map() }
	const { provenance } = finalizeSelection(seedSuites, allSuites, state, ctx, { explicitSuites })
	/** @type {Map<string, import('./continue_reason.mjs').ContinueReason>} */
	const reasons = new Map()
	stampExpansionReasons(reasons, slots, seedKeys, provenance, {
		explicitSuites,
		state,
		ctx,
	})
	return { provenance, seedKeys, explicitSuites, reasons }
}

/**
 * @param {SuiteDef[]} selected 已选 suite
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {object} ctx 依赖扩展上下文
 * @param {object} [options] 选项
 * @param {boolean} [options.explicitSuites] 是否显式指名 suite
 * @returns {{ suites: SuiteDef[], provenance: Map<string, string> }} 扩展结果与纳入原因
 */
export function finalizeSelection(selected, allSuites, state, ctx, options = {}) {
	/** @type {Map<string, string>} */
	const provenance = new Map()
	let suites = selected
	if (!options.explicitSuites) {
		const expanded = expandWithDependents(selected, allSuites, state, ctx)
		suites = expanded.suites
		for (const [key, parent] of expanded.provenance)
			provenance.set(key, parent)
	}
	const upstream = expandWithDependencies(suites, allSuites, state, ctx)
	for (const [key, parent] of upstream.provenance)
		provenance.set(key, parent)
	return { suites: upstream.suites, provenance }
}
