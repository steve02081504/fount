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
 * @typedef {object} SuiteStateEntry
 * @property {SuiteStatus} status
 * @property {string | null} commitHash
 * @property {string | null} uncommittedHash
 * @property {string | null} ranAt
 * @property {number | null} durationMs
 * @property {string | null} [triggerHash] 运行时 trigger 相关未提交文件内容 digest；用于重跑复用判定
 * @property {number | null} [baselineDurationMs]
 * @property {number | null} [baselineMemMb] 采样峰值内存基线（MB，EMA）
 * @property {number | null} [baselineCpuPct] 运行期间平均全机 CPU %（EMA）
 * @property {string[]} failedFiles
 * @property {string[]} noiseHits
 * @property {string | null} logPath
 * @property {boolean} [terminated]
 * @property {string | null} [terminateReason]
 * @property {string[]} [blockedBy]
 */

/**
 * @typedef {object} TestState
 * @property {Record<string, SuiteStateEntry>} suites
 */

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 */

/**
 * @param {string} manifestId manifest id
 * @param {string} name suite 名
 * @returns {string} suite 键
 */
export function suiteKey(manifestId, name) {
	return `${manifestId}/${name}`
}

/**
 * @param {string} repoRoot 仓库根
 * @returns {Promise<TestState>} 现状库
 */
export async function readState(repoRoot) {
	try {
		const raw = await readFile(stateFilePath(repoRoot), 'utf8')
		const data = JSON.parse(raw)
		return { suites: data.suites ?? {} }
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
 * 复用后把条目指纹对齐到当前 HEAD / 工作区（内容已验证一致）。
 * @param {TestState} state 现状库
 * @param {string} key suite 键
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {string | null} triggerHash trigger 内容指纹
 */
export function refreshEntryFingerprint(state, key, commitHash, uncommittedHash, triggerHash) {
	const entry = state.suites[key]
	if (!entry) return
	entry.commitHash = commitHash
	entry.uncommittedHash = uncommittedHash
	entry.triggerHash = triggerHash
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
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {TestState} params.state 现状库
 * @param {SuiteDef} params.suite suite
 * @param {object} params.result 运行结果
 * @param {boolean} params.result.passed 是否通过
 * @param {string[]} params.result.failedFiles 失败文件
 * @param {string} params.result.output 输出尾部
 * @param {number} params.result.durationMs 耗时
 * @param {boolean} [params.result.terminated] 是否被终止
 * @param {string} [params.result.terminateReason] 终止原因
 * @param {string[]} [params.blockedBy] 阻塞来源
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @param {string | null} [params.triggerHash] 本次运行的 trigger 内容指纹；缺省沿用 prev
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
}) {
	const key = suiteKey(suite.manifestId, suite.name)
	const prev = state.suites[key]
	const noiseHits = detectNoiseHits(result.output ?? '')
	const noisy = noiseHits.length > 0

	if (blockedBy?.length) {
		state.suites[key] = {
			status: 'blocked',
			commitHash: prev?.commitHash ?? null,
			uncommittedHash: prev?.uncommittedHash ?? null,
			ranAt: new Date().toISOString(),
			durationMs: null,
			triggerHash: prev?.triggerHash ?? null,
			baselineDurationMs: prev?.baselineDurationMs ?? null,
			baselineMemMb: prev?.baselineMemMb ?? null,
			baselineCpuPct: prev?.baselineCpuPct ?? null,
			failedFiles: [],
			noiseHits: [],
			logPath: prev?.logPath ?? null,
			blockedBy,
		}
		return state.suites[key]
	}

	let status /** @type {SuiteStatus} */
	if (!result.passed) status = 'failed'
	else if (noisy) status = 'noisy'
	else status = 'passed'

	let logPath = prev?.logPath ?? null
	if (status === 'passed') {
		if (logPath) {
			await deleteFailureLog(repoRoot, logPath)
			logPath = null
		}
	}
	else if (result.output)
		logPath = await persistFailureLog(repoRoot, suite, result.output)

	const baselineDurationMs = shouldRecordTimingBaseline(result)
		? updateBaselineDurationMs(prev?.baselineDurationMs, result.durationMs)
		: prev?.baselineDurationMs ?? null

	const baselineMemMb = shouldRecordTimingBaseline(result)
		? nextBaselineMemMb(prev?.baselineMemMb, result.peakMemMb)
		: prev?.baselineMemMb ?? null

	const baselineCpuPct = shouldRecordTimingBaseline(result)
		? nextBaselineCpuPct(prev?.baselineCpuPct, result.avgCpuPct)
		: prev?.baselineCpuPct ?? null

	state.suites[key] = {
		status,
		commitHash,
		uncommittedHash,
		ranAt: new Date().toISOString(),
		durationMs: result.durationMs,
		triggerHash: triggerHash !== undefined ? triggerHash : prev?.triggerHash ?? null,
		baselineDurationMs,
		baselineMemMb,
		baselineCpuPct,
		failedFiles: result.failedFiles ?? [],
		noiseHits,
		logPath,
		terminated: result.terminated ?? false,
		terminateReason: result.terminateReason ?? null,
	}

	return state.suites[key]
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} staleKeys 内容已变的 suite 键（裁决 unknown 且曾有 passed 记录等）
 * @returns {Promise<Set<string>>} 陈旧 suite 键
 */
export async function collectStaleSuiteKeys(repoRoot, allSuites, state, staleKeys) {
	return staleKeys
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
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} outdatedKeys 陈旧键
 * @param {Set<string>} staleKeys 状态库中已过时但仍标 passed 的 suite 键
 * @returns {Promise<string>} main.md 绝对路径
 */
export async function writeStateMarkdown(repoRoot, allSuites, state, staleKeys) {
	await mkdir(stateDir(repoRoot), { recursive: true })
	const path = stateMarkdownPath(repoRoot)
	await writeFile(path, buildStateMarkdown(allSuites, state, staleKeys), 'utf8')
	return path
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Set<string>} staleKeys 内容已变 suite 键
 * @returns {Promise<Set<string>>} 陈旧 suite 键并写入 main.md
 */
export async function refreshStateMarkdown(repoRoot, allSuites, state, staleKeys) {
	await writeStateMarkdown(repoRoot, allSuites, state, staleKeys)
	return staleKeys
}
