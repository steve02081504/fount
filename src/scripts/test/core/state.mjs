/**
 * 综合测试现状库：data/test/state/main.json + main.md + logs/
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { geti18n } from '../../i18n/bare.mjs'

import {
	nextBaselineCpuPct,
	nextBaselineDurationMs,
	nextBaselineMemMb,
} from './baseline.mjs'
import { digestFileHashes } from './changed.mjs'
import { formatDuration } from './format_duration.mjs'
import { matchGlob } from './glob.mjs'
import { detectNoiseHits, stripNoiseMarkers } from './output_filter.mjs'
import {
	stateDir,
	stateFilePath,
	stateLogPath,
	stateMarkdownPath,
	TEST_DATA_REL,
} from './paths.mjs'
import { filterTriggerRelevantFiles } from './trigger_filter.mjs'

/**
 * @typedef {'passed' | 'failed' | 'noisy' | 'blocked'} SuiteStatus
 */

/**
 * @typedef {object} SubtestStateEntry
 * @property {SuiteStatus} status
 * @property {string | null} commitHash
 * @property {string | null} uncommittedHash
 * @property {string | null} ranAt
 * @property {number | null} durationMs 子测试耗时基线（EMA，毫秒）
 * @property {string | null} [triggerHash]
 */

/**
 * @typedef {object} SuiteStateEntry
 * @property {SuiteStatus} status
 * @property {string | null} commitHash
 * @property {string | null} uncommittedHash
 * @property {string | null} ranAt
 * @property {number | null} durationMs
 * @property {string | null} [triggerHash] 运行时 trigger 相关未提交文件内容 digest；用于重跑复用判定
 * @property {number | null} [baselineDurationMs] 全量运行墙钟基线（EMA）；仅全量子测试跑完时更新
 * @property {number | null} [baselineOverheadMs] 固定开销基线（EMA）：wall − Σ 子测试耗时
 * @property {number | null} [baselineMemMb] 采样峰值内存基线（MB，EMA）
 * @property {number | null} [baselineCpuPct] 运行期间平均全机 CPU %（EMA）
 * @property {string[]} failedFiles
 * @property {string[]} noiseHits
 * @property {string | null} logPath
 * @property {boolean} [terminated]
 * @property {string | null} [terminateReason]
 * @property {string[]} [blockedBy]
 * @property {Record<string, SubtestStateEntry>} [subtests] 子测试状态
 */

/**
 * @typedef {object} TestState
 * @property {Record<string, SuiteStateEntry>} suites
 */

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 */

/**
 * suite 键与展示名统一为 CLI 选择器写法 `manifest:suite`（manifest id 可含 `/`，suite 名不含）。
 * @param {string} manifestId manifest id
 * @param {string} name suite 名
 * @returns {string} suite 键
 */
export function suiteKey(manifestId, name) {
	return `${manifestId}:${name}`
}

/**
 * 迁移旧版 `manifest/suite` 键为 `manifest:suite`（suite 名不含 `/`，故取最后一个 `/`）。
 * @param {string} key suite 键
 * @returns {string} 现行格式键
 */
export function migrateLegacySuiteKey(key) {
	if (key.includes(':')) return key
	const slash = key.lastIndexOf('/')
	if (slash < 0) return key
	return `${key.slice(0, slash)}:${key.slice(slash + 1)}`
}

/**
 * 迁移整个现状库的旧版键（含 blockedBy 引用）。
 * @param {Record<string, SuiteStateEntry>} suites 原始 suites 表
 * @returns {Record<string, SuiteStateEntry>} 迁移后的 suites 表
 */
export function migrateLegacyStateSuites(suites) {
	/** @type {Record<string, SuiteStateEntry>} */
	const migrated = {}
	for (const [key, entry] of Object.entries(suites)) {
		if (entry.blockedBy?.length)
			entry.blockedBy = entry.blockedBy.map(migrateLegacySuiteKey)
		migrated[migrateLegacySuiteKey(key)] = entry
	}
	return migrated
}

/**
 * @param {string} repoRoot 仓库根
 * @returns {Promise<TestState>} 现状库
 */
export async function readState(repoRoot) {
	try {
		const raw = await readFile(stateFilePath(repoRoot), 'utf8')
		const data = JSON.parse(raw)
		const before = data.suites ?? {}
		const suites = migrateLegacyStateSuites(before)
		const state = { suites }
		// 一次性落盘，避免外部工具仍读到旧 `manifest/suite` 键
		if (Object.keys(before).some(key => migrateLegacySuiteKey(key) !== key))
			await writeState(repoRoot, state)
		return state
	}
	catch (error) {
		if (error?.code === 'ENOENT') return { suites: {} }
		throw error
	}
}

/**
 * @param {string} repoRoot 仓库根
 * @param {TestState} state 现状库
 * @returns {Promise<void>}
 */
export async function writeState(repoRoot, state) {
	await mkdir(stateDir(repoRoot), { recursive: true })
	await writeFile(stateFilePath(repoRoot), `${JSON.stringify(state, null, '\t')}\n`, 'utf8')
}

/**
 * @param {SuiteDef} suite suite
 * @param {string[]} changedFiles 变更文件
 * @returns {{ matchedTriggers: string[], matchedPaths: string[] }} trigger 命中证据
 */
export function collectTriggerEvidence(suite, changedFiles) {
	const relevant = filterTriggerRelevantFiles(changedFiles, suite.triggerFilter)
	/** @type {string[]} */
	const matchedTriggers = []
	/** @type {string[]} */
	const matchedPaths = []
	for (const pat of suite.triggers) {
		const hits = relevant.filter(file => matchGlob(pat, file))
		if (hits.length) {
			matchedTriggers.push(pat)
			matchedPaths.push(...hits)
		}
	}
	return {
		matchedTriggers,
		matchedPaths: [...new Set(matchedPaths)],
	}
}

/**
 * @param {SuiteDef} suite suite
 * @param {string[]} changedFiles 变更文件
 * @param {{ entry?: SuiteStateEntry, currentTriggerHash?: string | null }} [opts] 可选指纹对照
 * @returns {{ matchedTriggerSets: string[], matchedTriggers: string[], matchedPaths: string[], triggerHashDrift: boolean }} trigger 命中证据
 */
export function collectStaleTriggerEvidence(suite, changedFiles, opts = {}) {
	const globEvidence = collectTriggerEvidence(suite, changedFiles)
	/** @type {string[]} */
	const matchedTriggers = [...globEvidence.matchedTriggers]
	/** @type {string[]} */
	const matchedPaths = [...globEvidence.matchedPaths]

	if (suite.subtests?.length) 
		for (const subtest of suite.subtests) {
			const relevant = filterTriggerRelevantFiles(changedFiles, suite.triggerFilter)
			for (const pat of subtest.triggers ?? []) {
				const hits = relevant.filter(file => matchGlob(pat, file))
				if (!hits.length) continue
				matchedTriggers.push(pat)
				matchedPaths.push(...hits)
			}
		}
	

	/** @type {string[]} */
	const matchedTriggerSets = []
	if (suite.triggerSetPatterns) {
		const relevant = filterTriggerRelevantFiles(changedFiles, suite.triggerFilter)
		for (const [ref, patterns] of Object.entries(suite.triggerSetPatterns)) {
			/** @type {string[]} */
			const hits = []
			for (const pat of patterns)
				hits.push(...relevant.filter(file => matchGlob(pat, file)))
			const unique = [...new Set(hits)]
			if (unique.length) {
				matchedTriggerSets.push(ref)
				matchedPaths.push(...unique)
			}
		}
	}

	const uniquePaths = [...new Set(matchedPaths)]
	const uniqueTriggers = [...new Set(matchedTriggers)]
	const entryHash = opts.entry?.triggerHash ?? null
	const currentHash = opts.currentTriggerHash !== undefined
		? opts.currentTriggerHash
		: null
	const triggerHashDrift = opts.entry != null
		&& entryHash !== currentHash
		&& !uniquePaths.length

	return {
		matchedTriggerSets,
		matchedTriggers: uniqueTriggers,
		matchedPaths: uniquePaths,
		triggerHashDrift,
	}
}

/**
 * @param {SuiteDef} suite suite
 * @param {string[]} changedFiles 变更文件
 * @returns {boolean} trigger 是否命中
 */
export function suiteTriggersHit(suite, changedFiles) {
	if (!changedFiles.length) return false
	return collectTriggerEvidence(suite, changedFiles).matchedPaths.length > 0
}

/**
 * 对 suite 命中的未提交文件内容取 digest；无相关未提交文件返回 null。
 * @param {SuiteDef} suite suite
 * @param {Map<string, string>} uncommittedHashes 未提交文件内容 digest 表（rel -> digest）
 * @returns {string | null} trigger 内容指纹
 */
export function computeSuiteTriggerHash(suite, uncommittedHashes) {
	const relevant = collectTriggerEvidence(suite, [...uncommittedHashes.keys()]).matchedPaths
	return digestFileHashes(uncommittedHashes, relevant)
}

/**
 * 复用 slot 处理完后把条目指纹对齐到当前 HEAD / 工作区（内容已验证一致）。
 * 勿在波次开始前批量调用——中断会导致未跑套件被标成当前 commit 已验证。
 * @param {TestState} state 现状库
 * @param {string} key suite 键
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {string | null} triggerHash trigger 内容指纹
 * @param {Record<string, string | null> | null} [subtestTriggerHashes] 子测试 triggerHash
 */
export function refreshEntryFingerprint(state, key, commitHash, uncommittedHash, triggerHash, subtestTriggerHashes = null) {
	const entry = state.suites[key]
	if (!entry) return
	entry.commitHash = commitHash
	entry.uncommittedHash = uncommittedHash
	entry.triggerHash = triggerHash
	if (!entry.subtests) return
	for (const [name, sub] of Object.entries(entry.subtests)) {
		sub.commitHash = commitHash
		sub.uncommittedHash = uncommittedHash
		if (subtestTriggerHashes && Object.hasOwn(subtestTriggerHashes, name))
			sub.triggerHash = subtestTriggerHashes[name]
	}
}

/**
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @returns {number | undefined} 基线耗时毫秒
 */
export function getSuiteBaselineDurationMs(entry) {
	return entry?.baselineDurationMs
}

/**
 * @param {{ passed: boolean, terminated?: boolean }} result suite 结果
 * @returns {boolean} 是否写入 timing 基线
 */
export function shouldRecordTimingBaseline(result) {
	return result.passed || !result.terminated
}

/**
 * @param {number | null | undefined} current 当前基线
 * @param {number} durationMs 本次耗时
 * @returns {number | null} 新基线
 */
export function updateBaselineDurationMs(current, durationMs) {
	return nextBaselineDurationMs(current, durationMs)
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef} suite suite
 * @param {string} output 有界内存尾部
 * @returns {Promise<string | null>} 相对 state 目录的 logPath
 */
async function persistFailureLog(repoRoot, suite, output) {
	if (!output) return null
	const abs = stateLogPath(repoRoot, suite.manifestId, suite.name)
	await mkdir(join(abs, '..'), { recursive: true })
	await writeFile(abs, stripNoiseMarkers(output), 'utf8')
	return `./${relative(stateDir(repoRoot), abs).replace(/\\/g, '/')}`
}

/**
 * @param {string} repoRoot 仓库根
 * @param {string | null | undefined} logPath 相对 logPath
 * @returns {Promise<void>}
 */
async function deleteFailureLog(repoRoot, logPath) {
	if (!logPath) return
	const abs = join(stateDir(repoRoot), logPath.replace(/^\.\//, ''))
	await rm(abs, { force: true })
}

/**
 * 失败文件是否属于给定子测试。
 * @param {import('./manifest.mjs').SubtestDef} subtest 子测试
 * @param {string[]} failedFiles 失败路径
 * @returns {boolean} 是否命中
 */
export function subtestMatchesFailedFiles(subtest, failedFiles) {
	const spec = subtest.spec.replace(/\\/g, '/')
	return failedFiles.some(file => {
		const rel = file.replace(/\\/g, '/')
		return rel === spec || rel.endsWith(`/${spec}`)
	})
}

/**
 * 合并子测试状态：只更新本次跑过的子集。
 * @param {SuiteDef} suite suite
 * @param {Record<string, SubtestStateEntry> | undefined} prev 上次子测试状态
 * @param {string[]} ranSubtests 本次跑过的子测试名
 * @param {string[]} failedFiles 失败文件
 * @param {boolean} noisy 本次是否含噪声
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {Record<string, string | null> | undefined} subtestTriggerHashes 子测试 triggerHash
 * @param {Record<string, number> | undefined} subtestDurations 本次子测试耗时
 * @param {boolean} recordTiming 是否写入耗时基线
 * @returns {Record<string, SubtestStateEntry> | undefined} 合并后的子测试状态
 */
function mergeSubtestStates(
	suite,
	prev,
	ranSubtests,
	failedFiles,
	noisy,
	commitHash,
	uncommittedHash,
	subtestTriggerHashes,
	subtestDurations,
	recordTiming,
) {
	if (!suite.subtests?.length) return prev
	/** @type {Record<string, SubtestStateEntry>} */
	const merged = { ...prev }
	const ranAt = new Date().toISOString()
	const byName = new Map(suite.subtests.map(st => [st.name, st]))
	for (const name of ranSubtests) {
		const subtest = byName.get(name)
		if (!subtest) continue
		const failed = subtestMatchesFailedFiles(subtest, failedFiles)
		/** @type {SuiteStatus} */
		let status = 'passed'
		if (failed) status = 'failed'
		// 失败断言栈自带 `Error:`，会被 detectNoiseHits 命中；勿把同轮已通过的兄弟子测试标成 noisy。
		else if (noisy && !failedFiles.length) status = 'noisy'
		const prevDuration = merged[name]?.durationMs ?? null
		const sample = subtestDurations?.[name]
		merged[name] = {
			status,
			commitHash,
			uncommittedHash,
			ranAt,
			durationMs: recordTiming && sample != null
				? updateBaselineDurationMs(prevDuration, sample)
				: prevDuration,
			triggerHash: subtestTriggerHashes?.[name] ?? merged[name]?.triggerHash ?? null,
		}
	}
	return merged
}

/**
 * 由合并后的子测试状态推导 suite 级 status。
 * @param {SuiteDef} suite suite
 * @param {Record<string, SubtestStateEntry> | undefined} subtests 子测试状态
 * @param {SuiteStatus} runStatus 本次运行原始 status
 * @returns {SuiteStatus} suite status
 */
function aggregateSuiteStatus(suite, subtests, runStatus) {
	if (!suite.subtests?.length) return runStatus
	let anyFailed = false
	let anyNoisy = false
	for (const st of suite.subtests) {
		const entry = subtests?.[st.name]
		if (!entry) continue
		if (entry.status === 'failed' || entry.status === 'blocked') anyFailed = true
		else if (entry.status === 'noisy') anyNoisy = true
	}
	if (anyFailed || runStatus === 'failed') return 'failed'
	if (anyNoisy || runStatus === 'noisy') return 'noisy'
	return 'passed'
}

/**
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {TestState} params.state 现状库
 * @param {SuiteDef} params.suite suite
 * @param {object} params.result 运行结果
 * @param {boolean} params.result.passed 是否通过
 * @param {string[]} params.result.failedFiles 失败文件
 * @param {string} params.result.output 输出尾部
 * @param {number} params.result.durationMs 耗时
 * @param {Record<string, number>} [params.result.subtestDurations] 子测试名 → 毫秒
 * @param {boolean} [params.result.terminated] 是否被终止
 * @param {string} [params.result.terminateReason] 终止原因
 * @param {string[]} [params.blockedBy] 阻塞来源
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @param {string | null} [params.triggerHash] 本次运行的 trigger 内容指纹；缺省沿用 prev
 * @param {string[]} [params.ranSubtests] 本次实际跑过的子测试名
 * @param {Record<string, string | null>} [params.subtestTriggerHashes] 子测试 triggerHash
 * @returns {Promise<SuiteStateEntry>} 新条目
 */
export async function upsertSuiteRun({
	repoRoot,
	state,
	suite,
	result,
	blockedBy,
	commitHash,
	uncommittedHash,
	triggerHash,
	ranSubtests,
	subtestTriggerHashes,
}) {
	const key = suiteKey(suite.manifestId, suite.name)
	const prev = state.suites[key]
	const noiseHits = detectNoiseHits(result.output ?? '')
	const noisy = noiseHits.length > 0

	if (blockedBy?.length) {
		// 投机丢弃也可能带真跑 output——落盘便于对照，不推进 baseline / fingerprint
		let logPath = prev?.logPath ?? null
		if (result?.output)
			logPath = await persistFailureLog(repoRoot, suite, result.output)
		state.suites[key] = {
			status: 'blocked',
			commitHash: prev?.commitHash ?? null,
			uncommittedHash: prev?.uncommittedHash ?? null,
			ranAt: new Date().toISOString(),
			durationMs: result?.durationMs ?? null,
			triggerHash: prev?.triggerHash ?? null,
			baselineDurationMs: prev?.baselineDurationMs ?? null,
			baselineOverheadMs: prev?.baselineOverheadMs ?? null,
			baselineMemMb: prev?.baselineMemMb ?? null,
			baselineCpuPct: prev?.baselineCpuPct ?? null,
			failedFiles: result?.failedFiles ?? [],
			noiseHits: detectNoiseHits(result?.output ?? ''),
			logPath,
			terminated: result?.terminated ?? false,
			terminateReason: result?.terminateReason ?? null,
			blockedBy,
			subtests: prev?.subtests,
		}
		return state.suites[key]
	}

	/** @type {SuiteStatus} */
	let runStatus = 'passed'
	if (!result.passed) runStatus = 'failed'
	else if (noisy) runStatus = 'noisy'

	const effectiveRan = ranSubtests ?? suite.subtests?.map(st => st.name) ?? []
	const recordTiming = shouldRecordTimingBaseline(result)
	const ranAllSubtests = !suite.subtests?.length
		|| suite.subtests.every(st => effectiveRan.includes(st.name))

	const subtests = mergeSubtestStates(
		suite,
		prev?.subtests,
		effectiveRan,
		result.failedFiles ?? [],
		noisy,
		commitHash,
		uncommittedHash,
		subtestTriggerHashes,
		result.subtestDurations,
		recordTiming,
	)
	const status = aggregateSuiteStatus(suite, subtests, runStatus)

	let logPath = prev?.logPath ?? null
	if (status === 'passed') {
		if (logPath) {
			await deleteFailureLog(repoRoot, logPath)
			logPath = null
		}
	}
	else if (result.output)
		logPath = await persistFailureLog(repoRoot, suite, result.output)

	const baselineDurationMs = recordTiming && ranAllSubtests
		? updateBaselineDurationMs(prev?.baselineDurationMs, result.durationMs)
		: prev?.baselineDurationMs ?? null

	let baselineOverheadMs = prev?.baselineOverheadMs ?? null
	if (recordTiming && suite.subtests?.length && result.subtestDurations) {
		const reportedSum = Object.values(result.subtestDurations)
			.reduce((sum, ms) => sum + (Number.isFinite(ms) ? ms : 0), 0)
		if (reportedSum > 0) {
			const overheadSample = Math.max(0, (result.durationMs ?? 0) - reportedSum)
			baselineOverheadMs = updateBaselineDurationMs(prev?.baselineOverheadMs, overheadSample)
		}
	}

	const baselineMemMb = recordTiming
		? nextBaselineMemMb(prev?.baselineMemMb, result.peakMemMb)
		: prev?.baselineMemMb ?? null

	const baselineCpuPct = recordTiming
		? nextBaselineCpuPct(prev?.baselineCpuPct, result.avgCpuPct)
		: prev?.baselineCpuPct ?? null

	// 有子测试时：未全部以当前 commit 跑过则不推进 suite.commitHash，避免掩盖未跑子测试的过期
	let nextCommitHash = commitHash
	if (suite.subtests?.length && subtests) {
		const allAtHead = suite.subtests.every(st => subtests[st.name]?.commitHash === commitHash)
		if (!allAtHead)
			nextCommitHash = prev?.commitHash ?? commitHash
	}

	state.suites[key] = {
		status,
		commitHash: nextCommitHash,
		uncommittedHash,
		ranAt: new Date().toISOString(),
		durationMs: result.durationMs,
		triggerHash: triggerHash !== undefined ? triggerHash : prev?.triggerHash ?? null,
		baselineDurationMs,
		baselineOverheadMs,
		baselineMemMb,
		baselineCpuPct,
		failedFiles: result.failedFiles ?? [],
		noiseHits,
		logPath,
		terminated: result.terminated ?? false,
		terminateReason: result.terminateReason ?? null,
		subtests,
	}

	return state.suites[key]
}

/**
 * @param {string} key suite 键
 * @returns {string} mermaid 节点 id
 */
function mermaidNodeId(key) {
	return key.replace(/[/\\:.-]/g, '_')
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} staleKeys 内容已变 suite 键
 * @returns {string} mermaid 源码
 */
function buildDependencyMermaid(allSuites, state, staleKeys) {
	const lines = ['flowchart TD']
	const classAssignments = []
	let edgeIndex = 0
	const blockedEdgeIndexes = []

	for (const suite of allSuites) {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		let visualStatus = 'unknown'
		if (staleKeys.has(key)) visualStatus = 'outdated'
		else if (!entry) visualStatus = 'unknown'
		else visualStatus = entry.status

		classAssignments.push(`${mermaidNodeId(key)}:::${visualStatus}`)
		lines.push(`  ${mermaidNodeId(key)}["${key}"]`)

		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			lines.push(`  ${mermaidNodeId(depKey)} --> ${mermaidNodeId(key)}`)
			const depEntry = state.suites[depKey]
			if (entry?.status === 'blocked' && entry.blockedBy?.includes(depKey))
				blockedEdgeIndexes.push(edgeIndex)
			else if (depEntry && depEntry.status !== 'passed' && depEntry.status !== 'noisy')
				blockedEdgeIndexes.push(edgeIndex)
			edgeIndex++
		}
	}

	lines.push(
		'  classDef passed fill:#d4edda,stroke:#28a745,color:#155724',
		'  classDef failed fill:#f8d7da,stroke:#dc3545,color:#721c24',
		'  classDef blocked fill:#e2e3e5,stroke:#6c757d,color:#383d41',
		'  classDef noisy fill:#fff3cd,stroke:#ffc107,color:#856404',
		'  classDef outdated fill:#ffe5cc,stroke:#fd7e14,color:#7a3e00',
		'  classDef unknown fill:#f8f9fa,stroke:#adb5bd,color:#495057',
		...classAssignments,
	)

	for (const index of blockedEdgeIndexes)
		lines.push(`  linkStyle ${index} stroke:#dc3545,stroke-width:2px`)

	return lines.join('\n')
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} staleKeys 内容已变 suite 键
 * @returns {string} markdown
 */
export function buildStateMarkdown(allSuites, state, staleKeys) {
	const lines = [
		`# ${geti18n('fountConsole.test.state.title')}`,
		'',
		geti18n('fountConsole.test.state.artifacts', { path: `${TEST_DATA_REL}/state/` }),
		'',
		`## ${geti18n('fountConsole.test.state.sectionDependencyTree')}`,
		'',
		'```mermaid',
		buildDependencyMermaid(allSuites, state, staleKeys),
		'```',
		'',
		`## ${geti18n('fountConsole.test.state.sectionOverview')}`,
		'',
		`| ${geti18n('fountConsole.test.state.columnSuite')} | ${geti18n('fountConsole.test.state.columnStatus')} | ${geti18n('fountConsole.test.state.columnCommit')} | ${geti18n('fountConsole.test.state.columnRanAt')} | ${geti18n('fountConsole.test.state.columnDuration')} | ${geti18n('fountConsole.test.state.columnLog')} |`,
		'| --- | --- | --- | --- | --- | --- |',
	]

	const keys = [...new Set([
		...allSuites.map(s => suiteKey(s.manifestId, s.name)),
		...Object.keys(state.suites),
	])].sort()

	for (const key of keys) {
		const entry = state.suites[key]
		let status = entry?.status ?? geti18n('fountConsole.test.state.statusUnknown')
		if (staleKeys.has(key) && entry?.status === 'passed')
			status = geti18n('fountConsole.test.state.statusOutdated')
		else if (!entry)
			status = geti18n('fountConsole.test.state.statusUnknown')
		else if (entry.status === 'blocked' && entry.blockedBy?.length)
			status = `${status} (${entry.blockedBy.join(', ')})`

		const commit = entry?.commitHash?.slice(0, 8) ?? '—'
		const ranAt = entry?.ranAt ?? '—'
		const duration = formatDuration(entry?.durationMs)
		const log = entry?.logPath ? `[log](${entry.logPath})` : '—'
		lines.push(`| ${key} | ${status} | \`${commit}\` | ${ranAt} | ${duration} | ${log} |`)
	}

	lines.push('')
	return lines.join('\n')
}

/**
 * 写入 state/main.md（依赖树 + 概览表）。
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} staleKeys 内容已变但仍标 passed 的 suite 键
 * @returns {Promise<string>} main.md 绝对路径
 */
export async function writeStateMarkdown(repoRoot, allSuites, state, staleKeys) {
	await mkdir(stateDir(repoRoot), { recursive: true })
	const path = stateMarkdownPath(repoRoot)
	await writeFile(path, buildStateMarkdown(allSuites, state, staleKeys), 'utf8')
	return path
}

