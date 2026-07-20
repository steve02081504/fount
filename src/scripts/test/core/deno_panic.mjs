/**
 * Deno 崩溃（panic）探测与自动上报。
 *
 * `fount test` 跑出的子进程若命中 `Deno has panicked. This is a bug in Deno.`，
 * 会解析崩溃位置（`panicked at <file>:<line>:<col>`）与 Deno 版本，去重后经 gh 自动向
 * Deno 仓库开 issue；若上游已有重复则改向 fount 仓库登记。去重记录落在 data/test/deno_panics.json，
 * Deno 版本变动即整体失效清空。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { exec, execFile, removeTerminalSequences } from 'npm:@steve02081504/exec'

import { console } from '../../i18n/bare.mjs'

import { denoPanicRecordPath } from './paths.mjs'

/** Deno 崩溃横幅标记。 */
const PANIC_MARKER = 'Deno has panicked. This is a bug in Deno.'

/** 上游 Deno 仓库（可用 FOUNT_DENO_PANIC_REPO 覆盖，测试时改成 fount 仓库自测）。 */
const DENO_REPO = process.env.FOUNT_DENO_PANIC_REPO || 'denoland/deno'

/** issue body 中携带的 log 尾部上限（字符）。 */
const LOG_EXCERPT_MAX = 20000

/** GitHub issue 标题上限（字符）。 */
export const GH_ISSUE_TITLE_MAX = 256

/** 自动上报 issue 标题前缀。 */
export const GH_ISSUE_TITLE_PREFIX = '[fount auto-report] Deno panic: '

/**
 * @typedef {object} ParsedPanic
 * @property {string} file 崩溃源码文件
 * @property {number} line 行号
 * @property {number} col 列号
 * @property {string} signature 去重签名（file:line:col）
 * @property {string} message 崩溃信息（panicked at 之后至 stack backtrace 之前，空白折叠）
 * @property {string | null} version Deno 版本（输出内自述）
 * @property {string | null} platform 平台串
 * @property {string | null} args 启动参数串
 * @property {string | null} stackUrl panic.deno.com 栈链接
 * @property {string} excerpt 供 issue 携带的 log 尾部
 */

/**
 * 从测试输出解析 Deno 崩溃信息；无崩溃返回 null。
 * @param {string} output 子进程 stdall（可能带 ANSI）
 * @returns {ParsedPanic | null} 解析结果
 */
export function parseDenoPanic(output) {
	if (!output) return null
	const text = removeTerminalSequences(output)
	if (!text.includes(PANIC_MARKER)) return null

	const at = text.match(/panicked at (.+):(\d+):(\d+):[^\n]*\n/)
	if (!at) return null

	const [, file, lineStr, colStr] = at
	const panicLineEnd = at.index + at[0].length
	const backtraceIdx = text.indexOf('\nstack backtrace:', panicLineEnd)
	let rawMessage
	if (backtraceIdx >= 0)
		rawMessage = text.slice(panicLineEnd, backtraceIdx)
	else {
		const nextThread = text.indexOf('\nthread \'', panicLineEnd)
		rawMessage = nextThread >= 0 ? text.slice(panicLineEnd, nextThread) : text.slice(panicLineEnd)
	}
	const message = rawMessage.replace(/\n\s*/g, ' ').trim()
	const version = text.match(/^Version:\s*(.+)$/m)?.[1]?.trim() ?? null
	const platform = text.match(/^Platform:\s*(.+)$/m)?.[1]?.trim() ?? null
	const args = text.match(/^Args:\s*(.+)$/m)?.[1]?.trim() ?? null
	const stackUrl = text.match(/https:\/\/panic\.deno\.com\/\S+/)?.[0] ?? null

	const markerIdx = text.indexOf(PANIC_MARKER)
	const from = Math.max(0, text.lastIndexOf('\n', Math.max(0, markerIdx - 400)) + 1)
	const excerpt = text.slice(from).trim().slice(-LOG_EXCERPT_MAX)

	return {
		file: file.trim(),
		line: Number(lineStr),
		col: Number(colStr),
		signature: `${file.trim()}:${lineStr}:${colStr}`,
		message,
		version,
		platform,
		args,
		stackUrl,
		excerpt,
	}
}

/**
 * 将自动上报标题适配 GitHub 256 字上限：先缩 summary 内括号，仍超则截断 summary。
 * @param {string} summary message 或 signature
 * @param {string} version Deno 版本
 * @returns {string} 标题
 */
export function fitGhIssueTitle(summary, version) {
	const suffix = ` (${version})`
	let title = `${GH_ISSUE_TITLE_PREFIX}${summary}${suffix}`
	if ([...title].length <= GH_ISSUE_TITLE_MAX) return title

	const shrunk = summary.replace(/\([^)]*\)/g, '(…)')
	title = `${GH_ISSUE_TITLE_PREFIX}${shrunk}${suffix}`
	if ([...title].length <= GH_ISSUE_TITLE_MAX) return title

	const ellipsis = '…'
	const budget = GH_ISSUE_TITLE_MAX
		- [...GH_ISSUE_TITLE_PREFIX].length
		- [...suffix].length
		- [...ellipsis].length
	const truncated = [...shrunk].slice(0, Math.max(0, budget)).join('') + ellipsis
	return `${GH_ISSUE_TITLE_PREFIX}${truncated}${suffix}`
}

/** Windows STATUS_HEAP_CORRUPTION：Deno 2.9.x 在 napi 模块析构时偶发，测试本身可能已全部通过。 */
const WINDOWS_DENO_TEARDOWN_EXIT = -1073740940
/** Windows STATUS_ACCESS_VIOLATION：teardown 阶段 native 析构偶发，测试本身可能已全部通过。 */
const WINDOWS_DENO_ACCESS_VIOLATION_EXIT = -1073741819

/** Linux/macOS：测试已绿后 native 析构偶发的致命信号（serial.mjs 从子进程 signal 传入）。 */
const POSIX_TEARDOWN_SIGNALS = new Set(['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL'])

/**
 * 从 deno test 输出取最后一次 `N passed | M failed` 摘要里的 failed 数；无摘要时 null。
 * @param {string} output 子进程 stdall
 * @returns {number | null} failed 数
 */
export function denoTestSummaryFailedCount(output) {
	const text = removeTerminalSequences(output)
	const matches = [...text.matchAll(/\|\s*(\d+)\s+passed\s*\|\s*(\d+)\s+failed/gu)]
	if (!matches.length) return null
	return Number(matches.at(-1)[2])
}

/**
 * 子进程非零退出但 deno test 摘要为 0 failed，且为 Deno panic / OS 析构崩溃。
 * @param {number} code 退出码
 * @param {string} output 子进程 stdall
 * @param {string | null} [signal] 终止信号（如 SIGSEGV）；Linux CI 上 green 后 napi 析构常见
 * @returns {boolean} 是否视为 teardown 噪声
 */
export function isDenoTeardownCrashAfterGreenTests(code, output, signal = null) {
	if (code === 0) return false
	const failedCount = denoTestSummaryFailedCount(output)
	if (failedCount !== null && failedCount !== 0) return false
	if (parseDenoPanic(output)) return true
	const posixTeardown = signal != null && POSIX_TEARDOWN_SIGNALS.has(String(signal).toUpperCase())
	const windowsTeardown = code === WINDOWS_DENO_TEARDOWN_EXIT || code === WINDOWS_DENO_ACCESS_VIOLATION_EXIT
	if (!posixTeardown && !windowsTeardown) return false
	if (failedCount === 0) return true
	// Deno 可能在打印 `ok | N passed | 0 failed` 摘要前即析构崩溃退出。
	const text = removeTerminalSequences(output)
	return !/\bFAILED\b/.test(text)
}

/**
 * 读取去重记录；缺失或版本漂移时返回空记录（并携带当前版本）。
 * @param {string} repoRoot 仓库根
 * @param {string | null} currentVersion 当前 Deno 版本
 * @returns {Promise<{ version: string | null, panics: Record<string, object> }>} 记录
 */
export async function readPanicRecord(repoRoot, currentVersion) {
	let record = { version: currentVersion, panics: {} }
	try {
		const parsed = JSON.parse(await readFile(denoPanicRecordPath(repoRoot), 'utf8'))
		record = { version: parsed.version ?? null, panics: parsed.panics ?? {} }
	}
	catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
	// 版本变动：旧记录整体失效清空。
	if (currentVersion && record.version !== currentVersion)
		record = { version: currentVersion, panics: {} }
	return record
}

/**
 * @param {string} repoRoot 仓库根
 * @param {object} record 去重记录
 * @returns {Promise<void>}
 */
async function writePanicRecord(repoRoot, record) {
	await mkdir(join(denoPanicRecordPath(repoRoot), '..'), { recursive: true })
	await writeFile(denoPanicRecordPath(repoRoot), `${JSON.stringify(record, null, '\t')}\n`, 'utf8')
}

/**
 * 探测 gh 是否可用且已登录。
 * @returns {Promise<boolean>} 可用即返回 true
 */
async function ghReady() {
	try {
		if ((await execFile('gh', ['--version'])).code !== 0) return false
		return (await execFile('gh', ['auth', 'status'])).code === 0
	}
	catch {
		return false
	}
}

/**
 * 解析 Deno 版本号（优先输出自述，其次 `deno -V`）。
 * @param {string | null} fromOutput 输出自述版本
 * @returns {Promise<string | null>} 版本号
 */
async function resolveDenoVersion(fromOutput) {
	if (fromOutput) return fromOutput
	try {
		return (await exec('deno -V')).stdout.trim().replace(/^deno\s+/i, '') || null
	}
	catch {
		return null
	}
}

/**
 * 用 gh 在指定仓库开 issue，返回 issue URL。
 * @param {string} repo owner/name
 * @param {string} title 标题
 * @param {string} body 正文
 * @returns {Promise<string | null>} issue URL
 */
async function ghCreateIssue(repo, title, body) {
	const dir = await mkdtemp(join(tmpdir(), 'fount-panic-'))
	const bodyFile = join(dir, 'body.md')
	try {
		await writeFile(bodyFile, body, 'utf8')
		const result = await execFile('gh', [
			'issue', 'create', '--repo', repo, '--title', title, '--body-file', bodyFile,
		])
		if (result.code !== 0) return null
		return (result.stdout ?? result.stdall ?? '').trim().split('\n').pop() || null
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
}

/**
 * 在上游仓库搜索重复崩溃 issue。
 * @param {string} repo owner/name
 * @param {ParsedPanic} panic 崩溃
 * @returns {Promise<string | null>} 命中的 issue URL；无则 null
 */
async function findDuplicateIssue(repo, panic) {
	const query = panic.message || panic.signature
	try {
		const result = await execFile('gh', [
			'issue', 'list', '--repo', repo, '--search', query,
			'--state', 'all', '--json', 'number,title,url', '--limit', '20',
		])
		if (result.code !== 0) return null
		const list = JSON.parse((result.stdout ?? result.stdall ?? '[]').trim() || '[]')
		return list[0]?.url ?? null
	}
	catch {
		return null
	}
}

/**
 * 拼装上报 issue 正文（body 面向 Deno 维护者，固定英文，不走 i18n）。
 * @param {ParsedPanic} panic 崩溃
 * @param {string} version Deno 版本
 * @param {string} commitHash fount 提交 hash
 * @returns {string} markdown 正文
 */
function buildIssueBody(panic, version, commitHash) {
	return `\
This issue was auto-generated by [\`fount test\`](https://github.com/steve02081504/fount/commit/${commitHash}) after it detected a Deno panic during a test run. If it duplicates an existing report, please close it. If you are being spammed by these auto-reports, that means \`fount test\` has a panic-deduplication bug — please report it at https://github.com/steve02081504/fount/issues.

- **Deno version**: \`${version}\`
- **panicked at**: \`${panic.signature}\`
${panic.message ? `- **message**: ${panic.message}` : ''}
${panic.platform ? `- **Platform**: ${panic.platform}` : ''}
${panic.stackUrl ? `- **Stack trace**: ${panic.stackUrl}` : ''}
${panic.args ? `- **Args**: \`${panic.args}\`` : ''}

<details><summary>fount test log</summary>

\`\`\`
${panic.excerpt}
\`\`\`

</details>
`
}

/** 串行化 reportDenoPanic 的读写，避免并发丢失条目或重复开上游 issue。 */
let panicReportChain = Promise.resolve()

/**
 * 探测测试输出中的 Deno 崩溃并自动上报（去重、版本失效、gh 发布）。
 * 全程 best-effort：任何失败仅告警，绝不打断测试流程。
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {string} params.output 子进程 stdall
 * @param {string} params.label suite 标签
 * @param {string} params.commitHash fount HEAD 提交 hash
 * @returns {Promise<void>}
 */
export function reportDenoPanic(params) {
	const next = panicReportChain.then(
		() => reportDenoPanicUnlocked(params),
		() => reportDenoPanicUnlocked(params),
	)
	panicReportChain = next.catch(() => {})
	return next
}

/**
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {string} params.output 子进程 stdall
 * @param {string} params.label suite 标签
 * @param {string} params.commitHash fount HEAD 提交 hash
 * @returns {Promise<void>}
 */
async function reportDenoPanicUnlocked({ repoRoot, output, label, commitHash }) {
	const panic = parseDenoPanic(output)
	if (!panic) return

	console.errorI18n('fountConsole.test.denoPanic.detected', {
		label,
		signature: panic.signature,
	})

	const version = await resolveDenoVersion(panic.version)
	const record = await readPanicRecord(repoRoot, version)
	const existing = record.panics[panic.signature]
	if (existing?.reported) {
		console.warnI18n('fountConsole.test.denoPanic.alreadyReported', { signature: panic.signature })
		return
	}

	if (!await ghReady()) {
		record.panics[panic.signature] = {
			file: panic.file, line: panic.line, col: panic.col,
			message: panic.message, reported: false, seenAt: new Date().toISOString(),
		}
		await writePanicRecord(repoRoot, record)
		console.warnI18n('fountConsole.test.denoPanic.ghUnavailable', { signature: panic.signature })
		return
	}

	// 上游已有重复：只本地登记，不再开任何新 issue。
	const duplicateOf = await findDuplicateIssue(DENO_REPO, panic)
	if (duplicateOf) {
		record.panics[panic.signature] = {
			file: panic.file, line: panic.line, col: panic.col,
			message: panic.message,
			reported: true,
			duplicateOf,
			issueUrl: duplicateOf,
			repo: DENO_REPO,
			reportedAt: new Date().toISOString(),
		}
		await writePanicRecord(repoRoot, record)
		console.warnI18n('fountConsole.test.denoPanic.duplicate', { upstream: duplicateOf })
		return
	}

	const title = fitGhIssueTitle(panic.message || panic.signature, version)
	const issueUrl = await ghCreateIssue(DENO_REPO, title, buildIssueBody(panic, version, commitHash))

	record.panics[panic.signature] = {
		file: panic.file, line: panic.line, col: panic.col,
		message: panic.message,
		reported: Boolean(issueUrl),
		duplicateOf: null,
		issueUrl: issueUrl ?? null,
		repo: DENO_REPO,
		reportedAt: new Date().toISOString(),
	}
	await writePanicRecord(repoRoot, record)

	if (!issueUrl)
		console.errorI18n('fountConsole.test.denoPanic.publishFailed', { signature: panic.signature })
	else
		console.logI18n('fountConsole.test.denoPanic.published', { url: issueUrl })
}
