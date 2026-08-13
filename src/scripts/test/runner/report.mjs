/**
 * 单次运行报告：data/test/report.md + report.json
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { geti18n } from '../../i18n/bare.mjs'
import { hasMeaningfulParallelSavings, summarizeEstimate } from '../core/estimate.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { reportJsonPath, reportMarkdownPath, TEST_DATA_REL, TRIGGERED_REASONS_FILE, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { formatExpectedDuration, formatParallelRatePct, summarizeRunTiming } from '../core/run_timing.mjs'
import { suiteKey } from '../core/state.mjs'

import { formatContinueReasonLabel } from './continue_reason.mjs'

/**
 * @typedef {import('./continue_reason.mjs').ContinueReason} ContinueReason
 * @typedef {import('../core/estimate.mjs').EstimateTask} EstimateTask
 * @typedef {import('../core/plan.mjs').PlanSlot} PlanSlot
 */

/**
 * 报告单槽快照。
 * @typedef {object} ReportSlot
 * @property {string} manifestId manifest id
 * @property {string} name suite 名
 * @property {'pending' | 'done'} state 槽位状态
 * @property {SuiteStateEntry['status']} [status] suite 运行状态
 * @property {number | null} [durationMs] 耗时（毫秒）
 * @property {string[]} [failedFiles] 失败文件
 * @property {string[]} [noiseHits] 噪声命中
 * @property {string | null} [logPath] 失败日志相对路径
 * @property {string[]} [blockedBy] 阻塞来源
 * @property {string[]} [skippedBy] skip_tree 跳过来源
 * @property {boolean} [terminated] 是否被 watchdog 终止
 * @property {string | null} [terminateReason] 终止原因
 * @property {ContinueReason} [continueReason] 纳入本波的原因
 * @property {string[]} [skipBecause] skip_because issue URL 列表
 * @property {string[]} [skipBecauseClosed] 其中已关闭、需跟进的 URL
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
	 * @param {PlanSlot[]} [options.planSlots] 计划槽位
	 * @param {string} options.runId 运行 id
	 * @param {string} options.command 命令摘要
	 * @param {string} options.commitHash HEAD
	 * @param {string | null} options.uncommittedHash 未提交 digest
	 * @param {Map<string, ContinueReason>} [options.continueReasons] suite 键 -> 触发原因
	 */
	constructor({ repoRoot, planSlots = [], runId, command, commitHash, uncommittedHash, continueReasons }) {
		this.repoRoot = repoRoot
		this.runId = runId
		this.command = command
		this.commitHash = commitHash
		this.uncommittedHash = uncommittedHash
		/** @type {ReportSlot[]} */
		this.slots = planSlots.map(slot => ({
			manifestId: slot.suite.manifestId,
			name: slot.suite.name,
			state: 'pending',
			continueReason: continueReasons?.get(slot.key),
		}))
		this.startedAt = new Date().toISOString()
		this.finishedAt = null
		this.exitCode = null
		/** @type {Map<string, EstimateTask> | null} */
		this.estimatePlan = null
		this.estimateOptions = null
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
	 * @param {string[]} [options.skipBecause] skip_because URL 列表
	 * @param {string[]} [options.skipBecauseClosed] 已关闭需跟进的 URL
	 * @param {string[]} [options.skippedBy] skip_tree 跳过来源
	 * @returns {Promise<void>}
	 */
	recordResult(index, entry, { reused = false, skipBecause, skipBecauseClosed, skippedBy } = {}) {
		return this.#enqueue(async () => {
			const slot = this.slots[index]
			this.slots[index] = {
				...slot,
				state: 'done',
				status: skippedBy?.length ? 'passed' : entry.status,
				durationMs: entry.durationMs,
				failedFiles: entry.failedFiles,
				noiseHits: entry.noiseHits,
				logPath: entry.logPath,
				blockedBy: entry.blockedBy,
				skippedBy: skippedBy ?? slot.skippedBy,
				terminated: entry.terminated,
				terminateReason: entry.terminateReason,
				reused,
				skipBecause: skipBecause ?? slot.skipBecause,
				skipBecauseClosed: skipBecauseClosed ?? slot.skipBecauseClosed,
			}
			await this.#writeFiles()
		})
	}

	/**
	 * 活报告：确保槽位存在；再次入队时回到 pending。
	 * @param {object} spec 槽
	 * @param {string} spec.manifestId manifest
	 * @param {string} spec.name suite 名
	 * @param {ContinueReason} [spec.continueReason] 纳入原因
	 * @returns {Promise<number>} 下标
	 */
	ensureSlot({ manifestId, name, continueReason }) {
		return this.#enqueue(async () => {
			const key = suiteKey(manifestId, name)
			let index = this.slots.findIndex(slot => suiteKey(slot.manifestId, slot.name) === key)
			if (index < 0) {
				this.slots.push({
					manifestId,
					name,
					state: 'pending',
					continueReason,
				})
				index = this.slots.length - 1
			}
			else
				this.slots[index] = {
					...this.slots[index],
					state: 'pending',
					continueReason: continueReason ?? this.slots[index].continueReason,
					skipBecause: undefined,
					skipBecauseClosed: undefined,
					reused: false,
				}
			await this.#writeFiles()
			return index
		})
	}

	/**
	 * 按 suite 键写入结果（没有槽则先创建）。
	 * @param {string} manifestId manifest
	 * @param {string} name suite 名
	 * @param {SuiteStateEntry} entry 现状条目
	 * @param {object} [options] 选项
	 * @param {boolean} [options.reused] 是否复用
	 * @param {string[]} [options.skipBecause] skip_because URL 列表
	 * @param {string[]} [options.skipBecauseClosed] 已关闭需跟进的 URL
	 * @param {ContinueReason} [options.continueReason] 纳入原因
	 * @returns {Promise<void>}
	 */
	async recordByKey(manifestId, name, entry, options = {}) {
		let index = this.slots.findIndex(slot => suiteKey(slot.manifestId, slot.name) === suiteKey(manifestId, name))
		if (index < 0)
			index = await this.ensureSlot({ manifestId, name, continueReason: options.continueReason })
		await this.recordResult(index, entry, options)
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
	 * @returns {ReturnType<typeof summarizeEstimate> | null} 待运行套件的剩余预估
	 */
	summarizePendingEstimate() {
		const pendingSlots = this.slots.filter(slot => slot.state === 'pending')
		if (!pendingSlots.length || !this.estimatePlan || !this.estimateOptions) return null
		const tasks = pendingSlots
			.map(slot => this.estimatePlan.get(suiteKey(slot.manifestId, slot.name)))
			.filter(Boolean)
		if (!tasks.length) return null
		return summarizeEstimate(tasks, this.estimateOptions)
	}

	/**
	 * @param {Map<string, EstimateTask>} plan suite 键 -> 预估任务
	 * @param {{ memBudgetBytes: number, cpuBudgetPct: number }} options 调度选项
	 * @returns {Promise<void>}
	 */
	setEstimatePlan(plan, options) {
		return this.#enqueue(async () => {
			this.estimatePlan = plan
			this.estimateOptions = options
			await this.#writeFiles()
		})
	}

	/**
	 * @param {() => Promise<void>} fn 任务
	 * @returns {Promise<void>}
	 */
	#enqueue(fn) {
		const next = this.#writeChain.then(fn)
		this.#writeChain = next.then(() => { }, () => { })
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
		const pendingSlots = this.slots.filter(slot => slot.state === 'pending')
		/** @type {ReturnType<typeof summarizeEstimate> | null} */
		let estimate = null
		/** @type {Record<string, { reused: boolean, blocked: boolean, durationMs: number | null }> | null} */
		let estimateTasks = null
		if (pendingSlots.length && this.estimatePlan && this.estimateOptions) {
			const tasks = pendingSlots
				.map(slot => this.estimatePlan.get(suiteKey(slot.manifestId, slot.name)))
				.filter(Boolean)
			if (tasks.length) {
				estimate = summarizeEstimate(tasks, this.estimateOptions)
				estimateTasks = Object.fromEntries(tasks.map(task => [
					task.key,
					{ reused: task.reused, blocked: task.blocked, durationMs: task.durationMs },
				]))
			}
		}
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
			estimate,
			estimateTasks,
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
 * 构建 report.md 正文。
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
		`| ${geti18n('fountConsole.test.report.field.runId')} | \`${summary.runId}\` |`,
		`| ${geti18n('fountConsole.test.report.field.command')} | \`${summary.command ?? geti18n('fountConsole.test.report.commandDefault')}\` |`,
		`| ${geti18n('fountConsole.test.report.field.exit')} | ${exitLabel} |`,
		`| ${geti18n('fountConsole.test.report.field.progress')} | ${geti18n('fountConsole.test.report.progressFormat', { completed: completed.length, total: summary.slots.length })} |`,
		`| ${geti18n('fountConsole.test.report.field.suites')} | ${geti18n('fountConsole.test.report.suitesFormat', { passed, completed: completed.length })} |`,
		`| ${geti18n('fountConsole.test.report.field.failed')} | ${failed} |`,
		`| ${geti18n('fountConsole.test.report.field.noisyPassed')} | ${noisy} |`,
		`| ${geti18n('fountConsole.test.state.column.blocked')} | ${blocked} |`,
		`| ${geti18n('fountConsole.test.report.field.reused')} | ${reused} |`,
		`| ${geti18n('fountConsole.test.report.field.suiteSumDuration')} | ${formatDuration(suiteSumMs)} |`,
		`| ${geti18n('fountConsole.test.report.field.wallClock')} | ${formatDuration(totalMs)} |`,
		`| ${geti18n('fountConsole.test.report.field.parallelRate')} | ${formatParallelRatePct(ratePct)} |`,
	]

	// 剩余全是复用/预计阻塞时 ETA≈0，无信息量，略去。
	if (summary.estimate?.runCount) {
		lines.push(
			`| ${geti18n('fountConsole.test.report.field.estimatedRemaining')} | ${formatEstimatePoint(summary.estimate.etaMs)} |`,
		)
		if (hasMeaningfulParallelSavings(summary.estimate))
			lines.push(
				`| ${geti18n('fountConsole.test.report.field.estimatedParallelRate')} | ${formatParallelRatePct(summary.estimate.parallelRatePct)} |`,
			)
	}

	lines.push(
		'',
		geti18n('fountConsole.test.report.artifacts', { path: `${TEST_DATA_REL}/report.md` }),
		'',
	)

	appendContinueReasonsLink(lines, summary)

	const skipped = completed.filter(s => s.skipBecause?.length)
	appendSkipSection(lines, skipped)
	appendSkipTreeSection(lines, completed.filter(s => s.skippedBy?.length))
	appendSection(lines, geti18n('fountConsole.test.report.section.failed'), completed.filter(s => s.status === 'failed' && !s.skipBecause?.length))
	appendSection(lines, geti18n('fountConsole.test.state.sectionBlocked'), completed.filter(s => s.status === 'blocked'))
	appendSection(lines, geti18n('fountConsole.test.report.section.noisyPassed'), completed.filter(s => s.status === 'noisy'))
	appendSilentPassed(lines, completed.filter(s => s.status === 'passed' && !s.skipBecause?.length && !s.skippedBy?.length))

	const pending = summary.slots.filter(slot => slot.state === 'pending')
	if (pending.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.section.pending')}`, '')
		if (summary.estimate?.runCount) {
			lines.push(geti18n('fountConsole.test.report.pending.estimate', {
				eta: formatDuration(summary.estimate.etaMs),
			}))
			if (hasMeaningfulParallelSavings(summary.estimate)) {
				lines.push(geti18n('fountConsole.test.report.pending.parallelEstimate', {
					eta: formatDuration(summary.estimate.parallelEtaMs),
					rate: formatParallelRatePct(summary.estimate.parallelRatePct),
				}))
				lines.push(geti18n('fountConsole.test.report.pending.savings', {
					savings: formatDuration(summary.estimate.savingsMs),
				}))
			}
			lines.push('')
		}
		for (const slot of pending) {
			const key = suiteKey(slot.manifestId, slot.name)
			const task = summary.estimateTasks?.[key]
			let mark = ''
			if (task?.reused) mark = ` ${geti18n('fountConsole.test.report.label.reused')}`
			else if (task?.blocked) mark = ` ${geti18n('fountConsole.test.report.label.expectedBlocked')}`
			const expected = mark ? null : formatExpectedDuration(task?.durationMs ?? null)
			const expectedMark = expected
				? ` — ${geti18n('fountConsole.test.report.pending.itemExpected', { expected })}`
				: ''
			lines.push(`- ${slot.manifestId}:${slot.name}${mark}${expectedMark}`)
		}
		lines.push('')
		lines.push(`## ${geti18n('fountConsole.test.report.section.continue')}`, '', '```shell', summary.command || 'fount test', '```', '')
	}

	return lines.join('\n')
}

/**
 * @param {number | null | undefined} etaMs 预估耗时（毫秒）
 * @returns {string} 可读单点 ETA
 */
function formatEstimatePoint(etaMs) {
	return geti18n('fountConsole.test.report.estimatePoint', {
		eta: formatDuration(etaMs),
	})
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
 * @param {string[]} lines 行缓冲
 * @param {ContinueReason} reason 续跑原因
 * @param {number} [depth] 嵌套深度（gate 子原因）
 */
function appendContinueReasonEvidence(lines, reason, depth = 0) {
	const indent = depth ? '  '.repeat(depth) : ''
	if (reason.fromCommit != null || reason.toCommit)
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.commitRange')}: \`${shortHash(reason.fromCommit)}\` → \`${shortHash(reason.toCommit)}\``)
	if (reason.fromUncommittedHash != null || reason.toUncommittedHash != null) {
		const from = shortHash(reason.fromUncommittedHash)
		const to = shortHash(reason.toUncommittedHash)
		if (from !== to)
			lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.uncommittedHashRange')}: \`${from}\` → \`${to}\``)
	}
	if (reason.blockedBy?.length)
		lines.push(`${indent}- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${reason.blockedBy.join(', ')}`)
	if (reason.matchedTriggerSets?.length) {
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.matchedTriggerSets')}:`)
		for (const setName of reason.matchedTriggerSets) lines.push(`${indent}  - \`${setName}\``)
	}
	if (reason.matchedTriggers?.length) {
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.matchedTriggers')}:`)
		for (const trigger of reason.matchedTriggers) lines.push(`${indent}  - \`${trigger}\``)
	}
	if (reason.matchedPaths?.length) {
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.matchedPaths')}:`)
		for (const path of reason.matchedPaths) lines.push(`${indent}  - \`${path}\``)
	}
	if (reason.triggerHashDrift || reason.kind === 'trigger_hash_drift')
		lines.push(`${indent}- ${geti18n('fountConsole.test.report.label.triggerHashDrift')}`)
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ContinueReason} reason 依赖扩展原因
 */
function appendDependencyReasonDetail(lines, reason) {
	if (reason.requiredBy)
		lines.push(`- ${geti18n('fountConsole.test.report.label.directRequiredBy')}: \`${reason.requiredBy}\``)
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

	const lines = [`# ${geti18n('fountConsole.test.report.section.continueReasons')}`, '']
	for (const slot of slots) {
		lines.push(`## ${slot.manifestId}:${slot.name}`, '')
		if (slot.continueReason.kind === 'dependency_required')
			appendDependencyReasonDetail(lines, slot.continueReason)
		else {
			lines.push(`- ${geti18n('fountConsole.test.report.label.continueReason')}: ${formatContinueReasonLabel(slot.continueReason)}`)
			appendContinueReasonEvidence(lines, slot.continueReason)
		}
		lines.push('')
	}
	return lines.join('\n')
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ReportSlot[]} entries skip 条目
 */
function appendSkipSection(lines, entries) {
	if (!entries.length) return
	lines.push(`## ${geti18n('fountConsole.test.report.section.skipped')}`, '')
	for (const entry of entries) {
		const urls = entry.skipBecause ?? []
		lines.push(`- ${entry.manifestId}:${entry.name} — ${geti18n('fountConsole.test.report.label.skipBecause')}: ${urls.join(' ')}`)
		if (entry.skipBecauseClosed?.length)
			lines.push(`  - ${geti18n('fountConsole.test.report.label.skipBecauseClosed')}: ${entry.skipBecauseClosed.join(' ')}`)
	}
	lines.push('')
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ReportSlot[]} entries skip_tree 下游
 */
function appendSkipTreeSection(lines, entries) {
	if (!entries.length) return
	lines.push(`## ${geti18n('fountConsole.test.report.section.skipTree')}`, '')
	for (const entry of entries)
		lines.push(`- ${entry.manifestId}:${entry.name} — ${geti18n('fountConsole.test.report.label.skipTree')}: ${(entry.skippedBy ?? []).join(', ')}`)
	lines.push('')
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
		const reusedMark = entry.reused ? ` ${geti18n('fountConsole.test.report.label.reused')}` : ''
		lines.push(`### ${entry.manifestId}:${entry.name}${reusedMark}`, '')
		if (entry.status !== 'blocked')
			lines.push(`- ${geti18n('fountConsole.test.report.label.duration')}: ${formatDuration(entry.durationMs)}`)
		if (entry.blockedBy?.length)
			lines.push(`- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${entry.blockedBy.join(', ')}`)
		if (entry.terminateReason)
			lines.push(`- ${geti18n('fountConsole.test.report.label.terminateReason')}: ${entry.terminateReason}`)
		if (entry.logPath) {
			const logLink = `./state/${entry.logPath.replace(/^\.\//, '')}`
			lines.push(`- ${geti18n('fountConsole.test.report.label.log')}: [${logLink}](${logLink})`)
		}
		if (entry.noiseHits?.length)
			lines.push(`- ${geti18n('fountConsole.test.report.label.noise')}: ${entry.noiseHits.join(', ')}`)
		if (entry.failedFiles?.length) {
			lines.push(`- ${geti18n('fountConsole.test.report.label.failedFiles')}:`)
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
	lines.push(`## ${geti18n('fountConsole.test.report.section.silentPassed')}`, '')
	lines.push(`| ${geti18n('fountConsole.test.report.columnSuite')} | ${geti18n('fountConsole.test.report.columnDuration')} |`)
	lines.push('| --- | --- |')
	for (const entry of entries) {
		const reusedMark = entry.reused ? ` ${geti18n('fountConsole.test.report.label.reused')}` : ''
		lines.push(`| ${entry.manifestId}:${entry.name}${reusedMark} | ${formatDuration(entry.durationMs)} |`)
	}
	lines.push('')
}

/**
 * 由已完成槽位推导进程退出码。
 * @param {ReportSlot[]} slots 槽位
 * @returns {number} 进程退出码（noisy / failed / blocked / pending 均非 0，避免 imperfect 含 noisy 时死循环）
 */
export function exitCodeFromSlots(slots) {
	if (slots.some(slot => slot.state === 'pending')) return 1
	const completed = slots.filter(slot => slot.state === 'done')
	return completed.some(slot =>
		slot.status === 'failed' || slot.status === 'blocked' || slot.status === 'noisy'
	) ? 1 : 0
}
