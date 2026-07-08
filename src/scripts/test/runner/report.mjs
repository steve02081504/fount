/**
 * 单次运行报告：data/test/report.md + report.json
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { geti18n } from '../../i18n/bare.mjs'
import { topoSortSuites } from '../core/dependencies.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { reportJsonPath, reportMarkdownPath, TEST_DATA_REL, TRIGGERED_REASONS_FILE, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { formatParallelRatePct, summarizeRunTiming } from '../core/run_timing.mjs'
import { suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('./continue_reason.mjs').ContinueReason} ContinueReason
 * @typedef {import('./continue_reason.mjs').ContinueReasonKind} ContinueReasonKind
 */

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').SuiteStateEntry} SuiteStateEntry
 */

/**
 * @typedef {object} ReportSlot
 * @property {string} manifestId
 * @property {string} name
 * @property {'pending' | 'done'} state
 * @property {SuiteStateEntry['status']} [status]
 * @property {number | null} [durationMs]
 * @property {string[]} [failedFiles]
 * @property {string[]} [noiseHits]
 * @property {string | null} [logPath]
 * @property {string[]} [blockedBy]
 * @property {boolean} [terminated]
 * @property {string | null} [terminateReason]
 * @property {ContinueReason} [continueReason]
 * @property {boolean} [reused] 本次未真跑、沿用上次结果
 */

/**
 * 单次运行报告写入器。
 */
export class RunReportWriter {
	/** @type {Promise<void>} */
	#writeChain = Promise.resolve()

	/**
	 * @param {object} options 选项
	 * @param {string} options.repoRoot 仓库根
	 * @param {SuiteDef[]} options.suites 本次运行 suite 列表
	 * @param {SuiteDef[]} [options.allSuites] 全库 suite（排序 tie-break；默认同 suites）
	 * @param {string} options.runId 运行 id
	 * @param {string} options.command 命令摘要
	 * @param {string} options.commitHash HEAD
	 * @param {string | null} options.uncommittedHash 未提交 digest
	 * @param {ReportSlot[]} [options.slots] 续跑时载入
	 * @param {Map<string, ContinueReason>} [options.continueReasons] suite 键 -> 续跑原因
	 */
	constructor({ repoRoot, suites, allSuites, runId, command, commitHash, uncommittedHash, slots, continueReasons }) {
		this.repoRoot = repoRoot
		this.runId = runId
		this.command = command
		this.commitHash = commitHash
		this.uncommittedHash = uncommittedHash
		/** @type {ReportSlot[]} */
		this.slots = slots ?? topoSortSuites(suites, allSuites ?? suites).map(suite => {
			const key = suiteKey(suite.manifestId, suite.name)
			return {
				manifestId: suite.manifestId,
				name: suite.name,
				state: 'pending',
				continueReason: continueReasons?.get(key),
			}
		})
		this.startedAt = new Date().toISOString()
		this.finishedAt = null
		this.exitCode = null
	}

	/**
	 * @param {string} repoRoot 仓库根
	 * @returns {Promise<RunReportWriter | null>} 未完成报告写入器；无则 null
	 */
	static async resume(repoRoot) {
		let raw
		try {
			raw = await readFile(reportJsonPath(repoRoot), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') return null
			throw error
		}
		const data = JSON.parse(raw)
		if (!Array.isArray(data.slots) || data.finishedAt) return null
		return new RunReportWriter({
			repoRoot,
			suites: [],
			runId: data.runId,
			command: data.command,
			commitHash: data.commitHash,
			uncommittedHash: data.uncommittedHash ?? null,
			slots: data.slots,
		})
	}

	/**
	 * @returns {Promise<string>} report.md 路径
	 */
	async init() {
		await mkdir(join(this.repoRoot, TEST_DATA_REL), { recursive: true })
		return this.#flush()
	}

	/**
	 * @param {number} index 槽位下标
	 * @param {SuiteStateEntry} entry 现状条目
	 * @param {object} [options] 选项
	 * @param {boolean} [options.reused] 是否复用上次结果
	 * @returns {Promise<void>}
	 */
	recordResult(index, entry, { reused = false } = {}) {
		return this.#enqueue(async () => {
			const slot = this.slots[index]
			this.slots[index] = {
				...slot,
				state: 'done',
				status: entry.status,
				durationMs: entry.durationMs,
				failedFiles: entry.failedFiles,
				noiseHits: entry.noiseHits,
				logPath: entry.logPath,
				blockedBy: entry.blockedBy,
				terminated: entry.terminated,
				terminateReason: entry.terminateReason,
				reused,
			}
			await this.#writeFiles()
		})
	}

	/**
	 * @param {number} exitCode 退出码
	 * @returns {Promise<string>} report.md 路径
	 */
	finalize(exitCode) {
		return this.#enqueue(async () => {
			this.exitCode = exitCode
			this.finishedAt = new Date().toISOString()
			await this.#writeFiles()
			return reportMarkdownPath(this.repoRoot)
		})
	}

	/**
	 * @returns {{ index: number, manifestId: string, name: string }[]} pending 槽位
	 */
	get pendingSlots() {
		/** @type {{ index: number, manifestId: string, name: string }[]} */
		const pending = []
		for (let index = 0; index < this.slots.length; index++) {
			const slot = this.slots[index]
			if (slot.state === 'pending')
				pending.push({ index, manifestId: slot.manifestId, name: slot.name })
		}
		return pending
	}

	/**
	 * @param {Map<string, ContinueReason>} continueReasons suite 键 -> 续跑原因
	 * @returns {Promise<void>}
	 */
	stampContinueReasons(continueReasons) {
		return this.#enqueue(async () => {
			for (let index = 0; index < this.slots.length; index++) {
				const slot = this.slots[index]
				const reason = continueReasons.get(suiteKey(slot.manifestId, slot.name))
				if (reason)
					this.slots[index] = { ...slot, continueReason: reason }
			}
			await this.#writeFiles()
		})
	}

	/**
	 * @param {() => Promise<void>} fn 任务
	 * @returns {Promise<void>}
	 */
	#enqueue(fn) {
		const next = this.#writeChain.then(fn)
		this.#writeChain = next.then(() => {}, () => {})
		return next
	}

	/**
	 * @returns {Promise<string>} report.md 路径
	 */
	async #flush() {
		await this.#writeFiles()
		return reportMarkdownPath(this.repoRoot)
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #writeFiles() {
		const completed = this.slots.filter(slot => slot.state === 'done')
		const timing = summarizeRunTiming(completed, {
			startedAt: this.startedAt,
			finishedAt: this.finishedAt,
		})
		const payload = {
			runId: this.runId,
			command: this.command,
			commitHash: this.commitHash,
			uncommittedHash: this.uncommittedHash,
			startedAt: this.startedAt,
			finishedAt: this.finishedAt,
			exitCode: this.exitCode,
			suiteSumMs: timing.suiteSumMs,
			wallClockMs: timing.wallClockMs,
			parallelRatePct: timing.parallelRatePct,
			slots: this.slots,
		}
		await writeFile(reportJsonPath(this.repoRoot), `${JSON.stringify(payload, null, '\t')}\n`, 'utf8')
		const reasonsMarkdown = buildContinueReasonsMarkdown(payload)
		if (reasonsMarkdown)
			await writeFile(triggeredReasonsMarkdownPath(this.repoRoot), reasonsMarkdown, 'utf8')
		else
			await rm(triggeredReasonsMarkdownPath(this.repoRoot), { force: true })
		await writeFile(reportMarkdownPath(this.repoRoot), buildRunMarkdown(payload, completed), 'utf8')
	}
}

/**
 * @param {object} summary 汇总
 * @param {ReportSlot[]} completed 已完成槽位
 * @returns {string} markdown 正文
 */
function buildRunMarkdown(summary, completed) {
	const passed = completed.filter(s => s.status === 'passed').length
	const failed = completed.filter(s => s.status === 'failed').length
	const noisy = completed.filter(s => s.status === 'noisy').length
	const blocked = completed.filter(s => s.status === 'blocked').length
	const reused = completed.filter(s => s.reused).length
	const { suiteSumMs, wallClockMs: totalMs, parallelRatePct: ratePct } = summarizeRunTiming(completed, summary)
	const exitLabel = summary.finishedAt == null
		? geti18n('fountConsole.test.report.exitInProgress')
		: (summary.exitCode === 0
			? geti18n('fountConsole.test.report.exitPassed')
			: geti18n('fountConsole.test.report.exitFailed')) + ` (${summary.exitCode})`

	const lines = [
		`# ${geti18n('fountConsole.test.report.title')}`,
		'',
		`| ${geti18n('fountConsole.test.report.tableHeaderItem')} | ${geti18n('fountConsole.test.report.tableHeaderValue')} |`,
		'| --- | --- |',
		`| ${geti18n('fountConsole.test.report.fieldRunId')} | \`${summary.runId}\` |`,
		`| ${geti18n('fountConsole.test.report.fieldCommand')} | \`${summary.command ?? geti18n('fountConsole.test.report.commandDefault')}\` |`,
		`| ${geti18n('fountConsole.test.report.fieldExit')} | ${exitLabel} |`,
		`| ${geti18n('fountConsole.test.report.fieldProgress')} | ${geti18n('fountConsole.test.report.progressFormat', { completed: completed.length, total: summary.slots.length })} |`,
		`| ${geti18n('fountConsole.test.report.fieldSuites')} | ${geti18n('fountConsole.test.report.suitesFormat', { passed, completed: completed.length })} |`,
		`| ${geti18n('fountConsole.test.report.fieldFailed')} | ${failed} |`,
		`| ${geti18n('fountConsole.test.report.fieldNoisyPassed')} | ${noisy} |`,
		`| ${geti18n('fountConsole.test.state.columnBlocked')} | ${blocked} |`,
		`| ${geti18n('fountConsole.test.report.fieldReused')} | ${reused} |`,
		`| ${geti18n('fountConsole.test.report.fieldSuiteSumDuration')} | ${formatDuration(suiteSumMs)} |`,
		`| ${geti18n('fountConsole.test.report.fieldWallClock')} | ${formatDuration(totalMs)} |`,
		`| ${geti18n('fountConsole.test.report.fieldParallelRate')} | ${formatParallelRatePct(ratePct)} |`,
		'',
		geti18n('fountConsole.test.report.artifacts', { path: `${TEST_DATA_REL}/report.md` }),
		'',
	]

	appendContinueReasonsLink(lines, summary)

	appendSection(lines, geti18n('fountConsole.test.report.sectionFailed'), completed.filter(s => s.status === 'failed'))
	appendSection(lines, geti18n('fountConsole.test.state.sectionBlocked'), completed.filter(s => s.status === 'blocked'))
	appendSection(lines, geti18n('fountConsole.test.report.sectionNoisyPassed'), completed.filter(s => s.status === 'noisy'))
	appendSilentPassed(lines, completed.filter(s => s.status === 'passed'))

	const pending = summary.slots.filter(slot => slot.state === 'pending')
	if (pending.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionPending')}`, '')
		for (const slot of pending)
			lines.push(`- ${slot.manifestId}/${slot.name}`)
		lines.push('')
		lines.push(`## ${geti18n('fountConsole.test.report.sectionContinue')}`, '', '```shell', 'fount test --continue', '```', '')
	}

	return lines.join('\n')
}

/**
 * @param {string | null | undefined} hash digest
 * @returns {string} 短 hash 展示
 */
function shortHash(hash) {
	if (!hash) return '—'
	return hash.length > 12 ? `${hash.slice(0, 8)}…` : hash
}

/**
 * @param {ContinueReasonKind | string} kind 原因类型
 * @param {{ strict?: boolean }} [opts] strict 时未知 kind 抛错
 * @returns {string} 可读标签
 */
function formatReasonKindLabel(kind, { strict = false } = {}) {
	switch (kind) {
		case 'pending_from_previous_report':
			return geti18n('fountConsole.test.report.reasonPending')
		case 'imperfect_failed':
			return geti18n('fountConsole.test.report.reasonImperfectFailed')
		case 'imperfect_noisy':
			return geti18n('fountConsole.test.report.reasonImperfectNoisy')
		case 'imperfect_blocked':
			return geti18n('fountConsole.test.report.reasonImperfectBlocked')
		case 'missing_state_record':
			return geti18n('fountConsole.test.report.reasonMissingRecord')
		case 'outdated_trigger_hit':
			return geti18n('fountConsole.test.report.reasonOutdatedTrigger')
		case 'diff_trigger_hit':
			return geti18n('fountConsole.test.report.reasonDiffTrigger')
		case 'explicit_selected':
			return geti18n('fountConsole.test.report.reasonExplicitSelected')
		case 'dependency_required':
			return geti18n('fountConsole.test.report.reasonDependencyRequired')
	}
	if (strict)
		throw new Error(`unknown continue reason kind: ${kind}`)
	return kind
}

/**
 * @param {ContinueReason} reason 续跑原因
 * @returns {string} 可读原因标签
 */
function formatContinueReasonLabel(reason) {
	return formatReasonKindLabel(reason.kind, { strict: true })
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ContinueReason} reason 续跑原因
 * @param {number} [depth] 嵌套深度（gate 子原因）
 */
function appendContinueReasonEvidence(lines, reason, depth = 0) {
	const indent = depth ? '  '.repeat(depth) : ''
	if (reason.fromCommit != null || reason.toCommit)
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.labelCommitRange')}: \`${shortHash(reason.fromCommit)}\` → \`${shortHash(reason.toCommit)}\``)
	if (reason.fromUncommittedHash != null || reason.toUncommittedHash != null) {
		const from = shortHash(reason.fromUncommittedHash)
		const to = shortHash(reason.toUncommittedHash)
		if (from !== to)
			lines.push(`${indent}- ${geti18n('fountConsole.test.report.labelUncommittedHashRange')}: \`${from}\` → \`${to}\``)
	}
	if (reason.blockedBy?.length)
		lines.push(`${indent}- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${reason.blockedBy.join(', ')}`)
	if (reason.matchedTriggers?.length) {
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.labelMatchedTriggers')}:`)
		for (const trigger of reason.matchedTriggers) lines.push(`${indent}  - \`${trigger}\``)
	}
	if (reason.matchedPaths?.length) {
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.labelMatchedPaths')}:`)
		for (const path of reason.matchedPaths) lines.push(`${indent}  - \`${path}\``)
	}
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ContinueReason} reason 依赖扩展原因
 */
function appendDependencyReasonDetail(lines, reason) {
	if (reason.rootKey && reason.rootKind)
		lines.push(`- ${geti18n('fountConsole.test.report.labelRootCause')}: ${formatReasonKindLabel(reason.rootKind)}（\`${reason.rootKey}\`）`)
	else if (reason.requiredBy)
		lines.push(`- ${geti18n('fountConsole.test.report.labelDirectRequiredBy')}: \`${reason.requiredBy}\``)
	if (reason.inclusionPath?.length)
		lines.push(`- ${geti18n('fountConsole.test.report.labelInclusionPath')}: ${reason.inclusionPath.map(k => `\`${k}\``).join(' → ')}`)
	if (reason.pull && reason.requiredBy) {
		const requiredBy = `\`${reason.requiredBy}\``
		const pullLabel = reason.pull === 'upstream'
			? geti18n('fountConsole.test.report.labelPullUpstream', { requiredBy })
			: geti18n('fountConsole.test.report.labelPullDownstream', { requiredBy })
		lines.push(`- ${pullLabel}`)
	}
	if (reason.gate) {
		lines.push(`- ${geti18n('fountConsole.test.report.labelGateReason')}: ${formatReasonKindLabel(reason.gate.kind)}`)
		appendContinueReasonEvidence(lines, reason.gate, 1)
	}
}

/**
 * 主报告中仅保留一句触发原因链接，详情落到独立文件。
 * @param {string[]} lines 行缓冲
 * @param {object} summary 汇总
 */
function appendContinueReasonsLink(lines, summary) {
	if (!summary.slots.some(slot => slot.continueReason)) return
	lines.push(geti18n('fountConsole.test.report.continueReasonsLink', { path: `./${TRIGGERED_REASONS_FILE}` }), '')
}

/**
 * 构建触发原因独立文件正文；无原因返回空串。
 * @param {object} summary 汇总
 * @returns {string} markdown 正文
 */
function buildContinueReasonsMarkdown(summary) {
	const slots = summary.slots.filter(slot => slot.continueReason)
	if (!slots.length) return ''

	const lines = [`# ${geti18n('fountConsole.test.report.sectionContinueReasons')}`, '']
	for (const slot of slots) {
		lines.push(`## ${slot.manifestId}/${slot.name}`, '')
		if (slot.continueReason.kind === 'dependency_required')
			appendDependencyReasonDetail(lines, slot.continueReason)
		else {
			lines.push(`- ${geti18n('fountConsole.test.report.labelContinueReason')}: ${formatContinueReasonLabel(slot.continueReason)}`)
			appendContinueReasonEvidence(lines, slot.continueReason)
		}
		lines.push('')
	}
	return lines.join('\n')
}

/**
 * @param {string[]} lines 行缓冲
 * @param {string} title 标题
 * @param {ReportSlot[]} entries 条目
 */
function appendSection(lines, title, entries) {
	if (!entries.length) return
	lines.push(`## ${title}`, '')
	for (const entry of entries) {
		const reusedMark = entry.reused ? ` ${geti18n('fountConsole.test.report.labelReused')}` : ''
		lines.push(`### ${entry.manifestId}/${entry.name}${reusedMark}`, '')
		if (entry.status !== 'blocked')
			lines.push(`- ${geti18n('fountConsole.test.report.labelDuration')}: ${formatDuration(entry.durationMs)}`)
		if (entry.blockedBy?.length)
			lines.push(`- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${entry.blockedBy.join(', ')}`)
		if (entry.terminateReason)
			lines.push(`- ${geti18n('fountConsole.test.report.labelTerminateReason')}: ${entry.terminateReason}`)
		if (entry.logPath) {
			const logLink = `./state/${entry.logPath.replace(/^\.\//, '')}`
			lines.push(`- ${geti18n('fountConsole.test.report.labelLog')}: [${logLink}](${logLink})`)
		}
		if (entry.noiseHits?.length)
			lines.push(`- ${geti18n('fountConsole.test.report.labelNoise')}: ${entry.noiseHits.join(', ')}`)
		if (entry.failedFiles?.length) {
			lines.push(`- ${geti18n('fountConsole.test.report.labelFailedFiles')}:`)
			for (const file of entry.failedFiles) lines.push(`  - \`${file}\``)
		}
		lines.push('')
	}
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ReportSlot[]} entries 条目
 */
function appendSilentPassed(lines, entries) {
	if (!entries.length) return
	lines.push(`## ${geti18n('fountConsole.test.report.sectionSilentPassed')}`, '')
	lines.push(`| ${geti18n('fountConsole.test.report.columnSuite')} | ${geti18n('fountConsole.test.report.columnDuration')} |`)
	lines.push('| --- | --- |')
	for (const entry of entries) {
		const reusedMark = entry.reused ? ` ${geti18n('fountConsole.test.report.labelReused')}` : ''
		lines.push(`| ${entry.manifestId}/${entry.name}${reusedMark} | ${formatDuration(entry.durationMs)} |`)
	}
	lines.push('')
}

/**
 * @param {ReportSlot[]} slots 槽位
 * @returns {number} 进程退出码
 */
export function exitCodeFromSlots(slots) {
	const completed = slots.filter(slot => slot.state === 'done')
	return completed.some(slot => slot.status !== 'passed') ? 1 : 0
}
