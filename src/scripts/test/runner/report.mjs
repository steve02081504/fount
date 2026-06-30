/**
 * fount test 聚合报告：落盘 noteworthy 输出并生成 report.md + report.json。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { geti18n } from '../../i18n.mjs'
import { detectNoiseHits, stripNoiseMarkers } from '../core/output_filter.mjs'
import {
	reportDir,
	reportFailuresLogDir,
	reportWarningsLogDir,
	TEST_DATA_REL,
} from '../core/paths.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 */

/**
 * @typedef {object} SuiteRunRecord
 * @property {SuiteDef} suite
 * @property {boolean} passed
 * @property {string[]} failedFiles
 * @property {string} output
 * @property {number} durationMs
 */

/**
 * @typedef {object} PendingSuiteEntry
 * @property {string} manifestId
 * @property {string} name
 * @property {true} pending
 */

/**
 * @typedef {object} ReportSuiteEntry
 * @property {string} manifestId
 * @property {string} name
 * @property {boolean} passed
 * @property {number} durationMs
 * @property {boolean} noisy
 * @property {string[]} noiseHits
 * @property {string[]} failedFiles
 * @property {string | null} logPath 相对 report 目录（如 ./logs/warnings/...）
 */

/** @typedef {PendingSuiteEntry | ReportSuiteEntry} ReportSuiteSlot */

/**
 * 将 manifestId/suite 名转为安全日志文件名。
 * @param {string} manifestId manifest id
 * @param {string} suiteName suite 名
 * @returns {string} 文件名（含 .log）
 */
function logFileName(manifestId, suiteName) {
	const safeManifest = manifestId.replace(/[/\\]/g, '_')
	const safeSuite = suiteName.replace(/[/:\\]/g, '_')
	return `${safeSuite}.log`
}

/**
 * 格式化毫秒为可读时长。
 * @param {number} ms 毫秒
 * @returns {string} 如 "1m 23s"
 */
function formatDuration(ms) {
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
 * @param {ReportSuiteSlot} entry suite 条目
 * @returns {entry is ReportSuiteEntry} 是否已完成
 */
function isCompletedEntry(entry) {
	return !('pending' in entry)
}

/**
 * 将单次 suite 运行结果落盘并生成条目。
 * @param {string} repoRoot 仓库根
 * @param {string} root report 根目录
 * @param {SuiteRunRecord} record 运行记录
 * @returns {Promise<ReportSuiteEntry>} 报告条目
 */
async function buildSuiteEntry(repoRoot, root, { suite, passed, failedFiles, output, durationMs }) {
	const noiseHits = detectNoiseHits(output)
	const noisy = noiseHits.length > 0
	const noteworthy = !passed || noisy
	/** @type {string | null} */
	let logPath = null

	if (noteworthy && output) {
		const subdir = passed ? reportWarningsLogDir(repoRoot) : reportFailuresLogDir(repoRoot)
		const manifestDir = join(subdir, suite.manifestId.replace(/[/\\]/g, '_'))
		await mkdir(manifestDir, { recursive: true })
		const logAbs = join(manifestDir, logFileName(suite.manifestId, suite.name))
		await writeFile(logAbs, stripNoiseMarkers(output), 'utf8')
		logPath = `./${relative(root, logAbs).replace(/\\/g, '/')}`
	}

	return {
		manifestId: suite.manifestId,
		name: suite.name,
		passed,
		durationMs,
		noisy,
		noiseHits,
		failedFiles,
		logPath,
	}
}

/**
 * 根据当前条目列表计算汇总。
 * @param {object} options 选项
 * @param {string} options.runId 运行 id
 * @param {string | null | undefined} options.command 命令
 * @param {number | null} options.exitCode 退出码（运行中为 null）
 * @param {ReportSuiteSlot[]} options.entries 全部槽位（含 pending）
 * @returns {object} summary
 */
function buildSummary({ runId, command, exitCode, entries }) {
	const completed = entries.filter(isCompletedEntry)
	const passedCount = completed.filter(e => e.passed).length
	const failedCount = completed.filter(e => !e.passed).length
	const noiseCount = completed.filter(e => e.passed && e.noisy).length

	return {
		runId,
		command: command ?? null,
		exitCode,
		complete: exitCode !== null,
		total: entries.length,
		completed: completed.length,
		passed: passedCount,
		failed: failedCount,
		noisyPassed: noiseCount,
		durationMs: completed.reduce((sum, e) => sum + e.durationMs, 0),
	}
}

/**
 * 增量测试报告写入器：每完成一个 suite 即刷新 report.md + report.json。
 */
export class TestReportWriter {
	/** @type {Promise<void>} */
	#writeChain = Promise.resolve()

	/**
	 * @param {object} options 选项
	 * @param {string} options.repoRoot 仓库根
	 * @param {import('../core/manifest.mjs').SuiteDef[]} options.suites 选定 suite 有序列表
	 * @param {string} options.runId 本次运行 id
	 * @param {string} [options.command] 命令行摘要
	 */
	constructor({ repoRoot, suites, runId, command }) {
		this.repoRoot = repoRoot
		this.root = reportDir(repoRoot)
		this.runId = runId
		this.command = command
		/** @type {ReportSuiteSlot[]} */
		this.entries = suites.map(suite => ({
			manifestId: suite.manifestId,
			name: suite.name,
			pending: true,
		}))
	}

	/**
	 * 初始化报告目录并写入 pending 状态。
	 * @returns {Promise<string>} report.md 绝对路径
	 */
	async init() {
		await rm(this.root, { recursive: true, force: true })
		await mkdir(join(this.root, 'logs', 'failures'), { recursive: true })
		await mkdir(join(this.root, 'logs', 'warnings'), { recursive: true })
		return this.#flush(null)
	}

	/**
	 * 记录单个 suite 结果并刷新报告。
	 * @param {number} index suite 在选定列表中的下标
	 * @param {SuiteRunRecord} record 运行记录
	 * @returns {Promise<void>}
	 */
	recordResult(index, record) {
		return this.#enqueue(async () => {
			this.entries[index] = await buildSuiteEntry(this.repoRoot, this.root, record)
			await this.#writeFiles(null)
		})
	}

	/**
	 * 写入最终退出码。
	 * @param {number} exitCode 进程退出码
	 * @returns {Promise<string>} report.md 绝对路径
	 */
	finalize(exitCode) {
		return this.#enqueue(async () => {
			await this.#writeFiles(exitCode)
			return join(this.root, 'report.md')
		})
	}

	/**
	 * @param {() => Promise<string>} fn 串行化执行的写盘任务
	 * @returns {Promise<string>} fn 的返回值
	 */
	#enqueue(fn) {
		const next = this.#writeChain.then(fn)
		this.#writeChain = next.then(() => {}, () => {})
		return next
	}

	/**
	 * @param {number | null} exitCode 退出码（null 表示仍在运行）
	 * @returns {Promise<string>} report.md 绝对路径
	 */
	async #flush(exitCode) {
		await this.#writeFiles(exitCode)
		return join(this.root, 'report.md')
	}

	/**
	 * @param {number | null} exitCode 退出码（null 表示仍在运行）
	 * @returns {Promise<void>}
	 */
	async #writeFiles(exitCode) {
		const summary = buildSummary({
			runId: this.runId,
			command: this.command,
			exitCode,
			entries: this.entries,
		})
		const reportJson = { summary, suites: this.entries }
		const jsonPath = join(this.root, 'report.json')
		await writeFile(jsonPath, `${JSON.stringify(reportJson, null, '\t')}\n`, 'utf8')
		const mdPath = join(this.root, 'report.md')
		await writeFile(mdPath, buildMarkdown(summary, this.entries), 'utf8')
	}
}

/**
 * 生成并写入聚合报告（先清空 data/test/report/）。
 * @param {object} options 选项
 * @param {string} options.repoRoot 仓库根
 * @param {SuiteRunRecord[]} options.results 全部 suite 结果（有序）
 * @param {string} options.runId 本次运行 id
 * @param {string} [options.command] 命令行摘要
 * @param {number} options.exitCode 进程退出码
 * @returns {Promise<string>} report.md 绝对路径
 */
export async function writeTestReport({
	repoRoot,
	results,
	runId,
	command,
	exitCode,
}) {
	const writer = new TestReportWriter({
		repoRoot,
		suites: results.map(({ suite }) => suite),
		runId,
		command,
	})
	await writer.init()
	for (let index = 0; index < results.length; index++)
		await writer.recordResult(index, results[index])
	return writer.finalize(exitCode)
}

/**
 * 根据套件条目构建可复制的重跑命令（按 manifest 分组，避免跨 manifest 误匹配 suite）。
 * @param {ReportSuiteEntry[]} entries 待重跑条目
 * @param {string | null | undefined} [originalCommand] 原始命令（用于保留 -j）
 * @returns {string[]} 每行一条 fount test 命令
 */
function buildReplayCommands(entries, originalCommand) {
	if (!entries.length) return []

	/** @type {Map<string, string[]>} */
	const byManifest = new Map()
	for (const e of entries) {
		const names = byManifest.get(e.manifestId) ?? []
		names.push(e.name)
		byManifest.set(e.manifestId, names)
	}

	let jobsSuffix = ''
	if (originalCommand) {
		const match = originalCommand.match(/\s-j\s+(\d+)/)
		if (match) jobsSuffix = ` -j ${match[1]}`
	}

	return [...byManifest.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([manifestId, suiteNames]) =>
			`fount test${jobsSuffix} ${manifestId} ${suiteNames.join(',')}`,
		)
}

/**
 * 生成 report.md 正文。
 * @param {object} summary 汇总
 * @param {string} summary.runId 运行 id
 * @param {string | null} summary.command 命令
 * @param {number | null} summary.exitCode 退出码（运行中为 null）
 * @param {boolean} summary.complete 是否已全部完成
 * @param {number} summary.total 总数
 * @param {number} summary.completed 已完成数
 * @param {number} summary.passed 通过数
 * @param {number} summary.failed 失败数
 * @param {number} summary.noisyPassed 通过但有噪声数
 * @param {number} summary.durationMs 总耗时
 * @param {ReportSuiteSlot[]} entries suite 条目
 * @returns {string} markdown
 */
function buildMarkdown(summary, entries) {
	const exitLabel = summary.complete
		? (summary.exitCode === 0
			? geti18n('fountConsole.test.report.exitPassed')
			: geti18n('fountConsole.test.report.exitFailed')) + ` (${summary.exitCode})`
		: geti18n('fountConsole.test.report.exitInProgress')
	const lines = [
		`# ${geti18n('fountConsole.test.report.title')}`,
		'',
		`| ${geti18n('fountConsole.test.report.tableHeaderItem')} | ${geti18n('fountConsole.test.report.tableHeaderValue')} |`,
		'| --- | --- |',
		`| ${geti18n('fountConsole.test.report.fieldRunId')} | \`${summary.runId}\` |`,
		`| ${geti18n('fountConsole.test.report.fieldCommand')} | \`${summary.command ?? geti18n('fountConsole.test.report.commandDefault')}\` |`,
		`| ${geti18n('fountConsole.test.report.fieldExit')} | ${exitLabel} |`,
		`| ${geti18n('fountConsole.test.report.fieldProgress')} | ${geti18n('fountConsole.test.report.progressFormat', { completed: summary.completed, total: summary.total })} |`,
		`| ${geti18n('fountConsole.test.report.fieldSuites')} | ${geti18n('fountConsole.test.report.suitesFormat', { passed: summary.passed, completed: summary.completed })} |`,
		`| ${geti18n('fountConsole.test.report.fieldFailed')} | ${summary.failed} |`,
		`| ${geti18n('fountConsole.test.report.fieldNoisyPassed')} | ${summary.noisyPassed} |`,
		`| ${geti18n('fountConsole.test.report.fieldDuration')} | ${formatDuration(summary.durationMs)} |`,
		'',
		geti18n('fountConsole.test.report.artifacts', { path: `${TEST_DATA_REL}/report/` }),
		'',
	]

	const completed = entries.filter(isCompletedEntry)
	const failed = completed.filter(e => !e.passed)
	if (failed.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionFailed')}`, '')
		for (const e of failed) {
			lines.push(`### ${e.manifestId}/${e.name}`, '')
			lines.push(`- ${geti18n('fountConsole.test.report.labelDuration')}: ${formatDuration(e.durationMs)}`)
			if (e.logPath) lines.push(`- ${geti18n('fountConsole.test.report.labelLog')}: [${e.logPath}](${e.logPath})`)
			if (e.noiseHits.length) lines.push(`- ${geti18n('fountConsole.test.report.labelNoise')}: ${e.noiseHits.join(', ')}`)
			if (e.failedFiles.length) {
				lines.push(`- ${geti18n('fountConsole.test.report.labelFailedFiles')}:`)
				for (const f of e.failedFiles) lines.push(`  - \`${f}\``)
			}
			lines.push('')
		}
	}

	const noisyPassed = completed.filter(e => e.passed && e.noisy)
	if (noisyPassed.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionNoisyPassed')}`, '')
		for (const e of noisyPassed) {
			lines.push(`### ${e.manifestId}/${e.name}`, '')
			lines.push(`- ${geti18n('fountConsole.test.report.labelDuration')}: ${formatDuration(e.durationMs)}`)
			lines.push(`- ${geti18n('fountConsole.test.report.labelNoise')}: ${e.noiseHits.join(', ')}`)
			if (e.logPath) lines.push(`- ${geti18n('fountConsole.test.report.labelLog')}: [${e.logPath}](${e.logPath})`)
			lines.push('')
		}
	}

	const allPassed = completed.filter(e => e.passed && !e.noisy)
	if (allPassed.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionSilentPassed')}`, '')
		lines.push(`| ${geti18n('fountConsole.test.report.columnSuite')} | ${geti18n('fountConsole.test.report.columnDuration')} |`)
		lines.push('| --- | --- |')
		for (const e of allPassed)
			lines.push(`| ${e.manifestId}/${e.name} | ${formatDuration(e.durationMs)} |`)
		lines.push('')
	}

	const pending = entries.filter(e => 'pending' in e)
	if (pending.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionPending')}`, '')
		lines.push(`| ${geti18n('fountConsole.test.report.columnSuite')} |`)
		lines.push('| --- |')
		for (const e of pending)
			lines.push(`| ${e.manifestId}/${e.name} |`)
		lines.push('')
	}

	const replayCommands = buildReplayCommands(failed, summary.command)
	if (replayCommands.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionReplay')}`, '')
		lines.push('```shell')
		for (const cmd of replayCommands)
			lines.push(cmd)
		lines.push('```', '')
	}

	const imperfect = completed.filter(e => !e.passed || e.noisy)
	const imperfectReplayCommands = buildReplayCommands(imperfect, summary.command)
	if (imperfectReplayCommands.length && imperfect.length !== failed.length) {
		lines.push(`## ${geti18n('fountConsole.test.report.sectionReplayImperfect')}`, '')
		lines.push('```shell')
		for (const cmd of imperfectReplayCommands)
			lines.push(cmd)
		lines.push('```', '')
	}

	return `${lines.join('\n')}`
}
