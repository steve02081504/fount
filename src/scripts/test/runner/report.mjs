/**
 * 单次运行报告：data/test/report.md + report.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { geti18n } from '../../i18n/bare.mjs'
import { detectNoiseHits } from '../core/output_filter.mjs'
import { reportJsonPath, reportMarkdownPath, TEST_DATA_REL } from '../core/paths.mjs'
import { suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('./continue_reason.mjs').ContinueReason} ContinueReason
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
 */

/**
 * @param {number} ms 毫秒
 * @returns {string} 可读时长
 */
function formatDuration(ms) {
	if (ms == null) return '—'
	if (ms < 1000) return geti18n('fountConsole.test.report.durationMs', { ms })
	const sec = Math.round(ms / 1000)
	if (sec < 60) return geti18n('fountConsole.test.report.durationSec', { sec })
	const min = Math.floor(sec / 60)
	const rem = sec % 60
	return rem
		? geti18n('fountConsole.test.report.durationMinSec', { min, sec: rem })
		: geti18n('fountConsole.test.report.durationMin', { min })
}

/**
 * 单次运行报告写入器。
 */
export class RunReportWriter {
	/** @type {Promise<void>} */
	#writeChain = Promise.resolve()

	/**
	 * @param {object} options 选项
	 * @param {string} options.repoRoot 仓库根
	 * @param {SuiteDef[]} options.suites 本次运行 suite 有序列表
	 * @param {string} options.runId 运行 id
	 * @param {string} options.command 命令摘要
	 * @param {string} options.commitHash HEAD
	 * @param {string | null} options.uncommittedHash 未提交 digest
	 * @param {ReportSlot[]} [options.slots] 续跑时载入
	 * @param {Map<string, ContinueReason>} [options.continueReasons] suite 键 -> 续跑原因
	 */
	constructor({ repoRoot, suites, runId, command, commitHash, uncommittedHash, slots, continueReasons }) {
		this.repoRoot = repoRoot
		this.runId = runId
		this.command = command
		this.commitHash = commitHash
		this.uncommittedHash = uncommittedHash
		/** @type {ReportSlot[]} */
		this.slots = slots ?? suites.map(suite => {
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
	 * @returns {Promise<void>}
	 */
	recordResult(index, entry) {
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
		const payload = {
			runId: this.runId,
			command: this.command,
			commitHash: this.commitHash,
			uncommittedHash: this.uncommittedHash,
			startedAt: this.startedAt,
			finishedAt: this.finishedAt,
			exitCode: this.exitCode,
			slots: this.slots,
		}
		await writeFile(reportJsonPath(this.repoRoot), `${JSON.stringify(payload, null, '\t')}\n`, 'utf8')
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
	const durationMs = completed.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
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
		`| ${geti18n('fountConsole.test.report.fieldDuration')} | ${formatDuration(durationMs)} |`,
		'',
		geti18n('fountConsole.test.report.artifacts', { path: `${TEST_DATA_REL}/report.md` }),
		'',
	]

	appendContinueReasons(lines, summary)

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
 * @param {ContinueReason} reason 续跑原因
 * @returns {string} 可读原因标签
 */
function formatContinueReasonLabel(reason) {
	switch (reason.kind) {
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
		case 'dependency_required':
			return geti18n('fountConsole.test.report.reasonDependencyRequired', {
				requiredBy: reason.requiredBy ?? '—',
			})
	}
	throw new Error(`unknown continue reason kind: ${reason.kind}`)
}

/**
 * @param {string[]} lines 行缓冲
 * @param {ContinueReason} reason 续跑原因
 */
function appendContinueReasonEvidence(lines, reason) {
	if (reason.fromCommit != null || reason.toCommit)
		lines.push(`- ${geti18n('fountConsole.test.report.labelCommitRange')}: \`${shortHash(reason.fromCommit)}\` → \`${shortHash(reason.toCommit)}\``)
	if (reason.fromUncommittedHash != null || reason.toUncommittedHash != null) {
		const from = shortHash(reason.fromUncommittedHash)
		const to = shortHash(reason.toUncommittedHash)
		if (from !== to)
			lines.push(`- ${geti18n('fountConsole.test.report.labelUncommittedHashRange')}: \`${from}\` → \`${to}\``)
	}
	if (reason.blockedBy?.length)
		lines.push(`- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${reason.blockedBy.join(', ')}`)
	if (reason.matchedTriggers?.length) {
		lines.push(`- ${geti18n('fountConsole.test.report.labelMatchedTriggers')}:`)
		for (const trigger of reason.matchedTriggers) lines.push(`  - \`${trigger}\``)
	}
	if (reason.matchedPaths?.length) {
		lines.push(`- ${geti18n('fountConsole.test.report.labelMatchedPaths')}:`)
		for (const path of reason.matchedPaths) lines.push(`  - \`${path}\``)
	}
}

/**
 * @param {string[]} lines 行缓冲
 * @param {object} summary 汇总
 */
function appendContinueReasons(lines, summary) {
	const slots = summary.slots.filter(slot => slot.continueReason)
	if (!slots.length) return

	lines.push(`## ${geti18n('fountConsole.test.report.sectionContinueReasons')}`, '')
	for (const slot of slots) {
		lines.push(`### ${slot.manifestId}/${slot.name}`, '')
		lines.push(`- ${geti18n('fountConsole.test.report.labelContinueReason')}: ${formatContinueReasonLabel(slot.continueReason)}`)
		appendContinueReasonEvidence(lines, slot.continueReason)
		lines.push('')
	}
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
		lines.push(`### ${entry.manifestId}/${entry.name}`, '')
		lines.push(`- ${geti18n('fountConsole.test.report.labelDuration')}: ${formatDuration(entry.durationMs)}`)
		if (entry.blockedBy?.length)
			lines.push(`- ${geti18n('fountConsole.test.state.labelBlockedBy')}: ${entry.blockedBy.join(', ')}`)
		if (entry.terminateReason)
			lines.push(`- ${geti18n('fountConsole.test.report.labelTerminateReason')}: ${entry.terminateReason}`)
		if (entry.logPath)
			lines.push(`- ${geti18n('fountConsole.test.report.labelLog')}: [${entry.logPath}](${entry.logPath})`)
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
	for (const entry of entries)
		lines.push(`| ${entry.manifestId}/${entry.name} | ${formatDuration(entry.durationMs)} |`)
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

/**
 * @param {SuiteDef[]} suites suite 列表
 * @returns {string | null} 可复制重跑命令
 */
export function buildReplayCommand(suites) {
	if (!suites.length) return null
	/** @type {Map<string, string[]>} */
	const byManifest = new Map()
	for (const suite of suites) {
		const names = byManifest.get(suite.manifestId) ?? []
		names.push(suite.name)
		byManifest.set(suite.manifestId, names)
	}
	const groupTokens = [...byManifest.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([manifestId, suiteNames]) => `${manifestId}:${suiteNames.join(',')}`)
	return `fount test ${groupTokens.join(' ')}`
}

/**
 * @param {string} output 输出
 * @returns {string[]} 噪声命中列表
 */
export function detectReportNoiseHits(output) {
	return detectNoiseHits(output)
}

/**
 * @param {SuiteDef} suite suite
 * @returns {string} 标签
 */
export function labelForSuite(suite) {
	return suiteKey(suite.manifestId, suite.name)
}
