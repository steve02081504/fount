/**
 * fount test 聚合报告：落盘 noteworthy 输出并生成 report.md + report.json。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { detectNoiseHits } from '../core/output_filter.mjs'
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
 * 判断 suite 结果是否 noteworthy（失败或含噪声）。
 * @param {SuiteRunRecord} record 运行记录
 * @returns {boolean} 是否 noteworthy
 */
function isNoteworthy(record) {
	return !record.passed || detectNoiseHits(record.output).length > 0
}

/**
 * 格式化毫秒为可读时长。
 * @param {number} ms 毫秒
 * @returns {string} 如 "1m 23s"
 */
function formatDuration(ms) {
	if (ms < 1000) return `${ms}ms`
	const sec = Math.round(ms / 1000)
	if (sec < 60) return `${sec}s`
	const min = Math.floor(sec / 60)
	const rem = sec % 60
	return rem ? `${min}m ${rem}s` : `${min}m`
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
	const root = reportDir(repoRoot)
	await rm(root, { recursive: true, force: true })
	await mkdir(join(root, 'logs', 'failures'), { recursive: true })
	await mkdir(join(root, 'logs', 'warnings'), { recursive: true })

	/** @type {ReportSuiteEntry[]} */
	const entries = []
	let failedCount = 0
	let noiseCount = 0

	for (const { suite, passed, failedFiles, output, durationMs } of results) {
		const noisy = detectNoiseHits(output).length > 0
		const noteworthy = !passed || noisy
		/** @type {string | null} */
		let logPath = null

		if (noteworthy && output) {
			const subdir = passed ? reportWarningsLogDir(repoRoot) : reportFailuresLogDir(repoRoot)
			const manifestDir = join(subdir, suite.manifestId.replace(/[/\\]/g, '_'))
			await mkdir(manifestDir, { recursive: true })
			const logAbs = join(manifestDir, logFileName(suite.manifestId, suite.name))
			await writeFile(logAbs, output, 'utf8')
			logPath = `./${relative(root, logAbs).replace(/\\/g, '/')}`
		}

		if (!passed) failedCount++
		else if (noisy) noiseCount++

		entries.push({
			manifestId: suite.manifestId,
			name: suite.name,
			passed,
			durationMs,
			noisy,
			noiseHits: detectNoiseHits(output),
			failedFiles,
			logPath,
		})
	}

	const passedCount = results.filter(r => r.passed).length
	const summary = {
		runId,
		command: command ?? null,
		exitCode,
		total: results.length,
		passed: passedCount,
		failed: failedCount,
		noisyPassed: noiseCount,
		durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
	}

	const reportJson = { summary, suites: entries }
	const jsonPath = join(root, 'report.json')
	await writeFile(jsonPath, `${JSON.stringify(reportJson, null, '\t')}\n`, 'utf8')

	const md = buildMarkdown(summary, entries)
	const mdPath = join(root, 'report.md')
	await writeFile(mdPath, md, 'utf8')

	return mdPath
}

/**
 * 生成 report.md 正文。
 * @param {object} summary 汇总
 * @param {string} summary.runId 运行 id
 * @param {string | null} summary.command 命令
 * @param {number} summary.exitCode 退出码
 * @param {number} summary.total 总数
 * @param {number} summary.passed 通过数
 * @param {number} summary.failed 失败数
 * @param {number} summary.noisyPassed 通过但有噪声数
 * @param {number} summary.durationMs 总耗时
 * @param {ReportSuiteEntry[]} entries suite 条目
 * @returns {string} markdown
 */
function buildMarkdown(summary, entries) {
	const lines = [
		'# fount test report',
		'',
		'| 项 | 值 |',
		'| --- | --- |',
		`| runId | \`${summary.runId}\` |`,
		`| command | \`${summary.command ?? '(default)'}\` |`,
		`| exit | ${summary.exitCode === 0 ? 'PASSED' : 'FAILED'} (${summary.exitCode}) |`,
		`| suites | ${summary.passed}/${summary.total} passed |`,
		`| failed | ${summary.failed} |`,
		`| noisy (passed) | ${summary.noisyPassed} |`,
		`| duration | ${formatDuration(summary.durationMs)} |`,
		'',
		`Artifacts: \`${TEST_DATA_REL}/report/\``,
		'',
	]

	const failed = entries.filter(e => !e.passed)
	if (failed.length) {
		lines.push('## Failed suites', '')
		for (const e of failed) {
			lines.push(`### ${e.manifestId}/${e.name}`, '')
			lines.push(`- duration: ${formatDuration(e.durationMs)}`)
			if (e.logPath) lines.push(`- log: [${e.logPath}](${e.logPath})`)
			if (e.noiseHits.length) lines.push(`- noise: ${e.noiseHits.join(', ')}`)
			if (e.failedFiles.length) {
				lines.push('- failed files:')
				for (const f of e.failedFiles) lines.push(`  - \`${f}\``)
			}
			lines.push('')
		}
	}

	const noisyPassed = entries.filter(e => e.passed && e.noisy)
	if (noisyPassed.length) {
		lines.push('## Passed with noise', '')
		for (const e of noisyPassed) {
			lines.push(`### ${e.manifestId}/${e.name}`, '')
			lines.push(`- duration: ${formatDuration(e.durationMs)}`)
			lines.push(`- noise: ${e.noiseHits.join(', ')}`)
			if (e.logPath) lines.push(`- log: [${e.logPath}](${e.logPath})`)
			lines.push('')
		}
	}

	const allPassed = entries.filter(e => e.passed && !e.noisy)
	if (allPassed.length) {
		lines.push('## Passed (silent)', '')
		lines.push('| suite | duration |')
		lines.push('| --- | --- |')
		for (const e of allPassed)
			lines.push(`| ${e.manifestId}/${e.name} | ${formatDuration(e.durationMs)} |`)
		lines.push('')
	}

	return `${lines.join('\n')}`
}
