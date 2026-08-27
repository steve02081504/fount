/**
 * 显示层：空默认波次必须说出「无需再跑」，不能静默 exit 0。
 */
/* global Deno */
import process from 'node:process'

import { assertEquals } from 'jsr:@std/assert'

import { console } from '../../i18n/bare.mjs'
import { allowNoise } from '../core/allowNoise.mjs'
import { formatNoiseAllowBegin, formatNoiseAllowEnd } from '../core/output_filter.mjs'
import { TestDashboard, renderBar, stripAnsi, visibleWidth, wrapByWidth } from '../display/dashboard.mjs'
import { displayShouldResolve, resolveDisplayMode } from '../display/mode.mjs'
import { formatFailureOutput, paintAccepted, paintJobDone, paintJobWait, paintSuiteEnd } from '../display/paint.mjs'
import { acceptedFromWave } from '../kernel/jobs.mjs'

/**
 * 截获 logI18n / errorI18n 键。
 * @param {() => void} fn 回调
 * @returns {{ logs: { key: string, params?: object }[], errors: { key: string, params?: object }[] }} 记录
 */
function captureI18n(fn) {
	const logs = []
	const errors = []
	const logOrig = console.logI18n
	const errOrig = console.errorI18n
	/**
	 * 记录 logI18n 调用。
	 * @param {string} key i18n 键
	 * @param {object} [params] 插值
	 * @returns {void}
	 */
	function logSpy(key, params) { logs.push({ key, params }) }
	/**
	 * 记录 errorI18n 调用。
	 * @param {string} key i18n 键
	 * @param {object} [params] 插值
	 * @returns {void}
	 */
	function errSpy(key, params) { errors.push({ key, params }) }
	/** 恢复原始 console.logI18n / console.errorI18n。 */
	const restore = () => {
		console.logI18n = logOrig
		console.errorI18n = errOrig
	}
	console.logI18n = logSpy
	console.errorI18n = errSpy
	let result
	try {
		result = fn()
	}
	catch (error) {
		restore()
		throw error
	}
	if (result && typeof result.then === 'function')
		return result.finally(restore).then(() => ({ logs, errors }))
	restore()
	return { logs, errors }
}

Deno.test('acceptedFromWave marks default empty wave', () => {
	const msg = acceptedFromWave({ empty: true, code: 0 }, { runCount: 0, reuseCount: 0, blockedCount: 0 })
	assertEquals(msg.empty, true)
	assertEquals(msg.error, null)
	assertEquals(msg.code, 0)
	assertEquals(msg.runCount, 0)
})

Deno.test('paintAccepted empty default prints nothingToContinue', () => {
	const { logs, errors } = captureI18n(() => paintAccepted({
		empty: true,
		code: 0,
		runCount: 0,
		error: null,
	}))
	assertEquals(logs.map(row => row.key), ['fountConsole.test.nothingToContinue'])
	assertEquals(errors, [])
})

Deno.test('paintAccepted stale kernel runCount 0 still prints nothingToContinue', () => {
	const { logs } = captureI18n(() => paintAccepted({ runCount: 0, code: 0 }))
	assertEquals(logs.map(row => row.key), ['fountConsole.test.nothingToContinue'])
})

Deno.test('paintAccepted noisyOnly does not look like all-green', () => {
	const { logs } = captureI18n(() => paintAccepted({
		empty: true,
		error: 'noisyOnly',
		code: 1,
		noisyKeys: ['server:live'],
	}))
	assertEquals(logs[0]?.key, 'fountConsole.test.noisyOnlyRemain')
	assertEquals(logs.some(row => row.key === 'fountConsole.test.nothingToContinue'), false)
})

Deno.test('bare continue job is overview regardless of runCount', () => {
	assertEquals(resolveDisplayMode({ watch: false, job: {}, runCount: 3 }), 'overview')
	assertEquals(resolveDisplayMode({ watch: true, job: undefined, runCount: 0 }), 'overview')
	assertEquals(resolveDisplayMode({
		watch: false,
		job: { groups: [{ manifestSelectors: ['checks'], suiteSelectors: ['i18n_keys'] }] },
		runCount: 1,
	}), 'stream')
	assertEquals(resolveDisplayMode({
		watch: false,
		job: { groups: [{ manifestSelectors: ['shells/chat'], suiteSelectors: ['pure', 'integration'] }] },
		runCount: 2,
	}), 'multi')
	assertEquals(resolveDisplayMode({
		watch: false,
		job: { groups: [{ manifestSelectors: ['checks'], suiteSelectors: ['text_lf'] }] },
		runCount: 0,
	}), 'stream')
})

Deno.test('displayShouldResolve: overview waits for idle unless empty job', () => {
	const overview = { watch: false, displayMode: 'overview', job: {}, runCount: 2 }
	assertEquals(displayShouldResolve({ type: 'job-done' }, overview), false)
	assertEquals(displayShouldResolve({ type: 'idle' }, overview), true)
	assertEquals(displayShouldResolve({ type: 'job-done' }, { ...overview, runCount: 0 }), true)
	assertEquals(displayShouldResolve({ type: 'idle' }, { ...overview, watch: true }), false)
	assertEquals(displayShouldResolve({ type: 'job-done' }, {
		watch: false,
		displayMode: 'stream',
		job: { groups: [{}] },
		runCount: 1,
	}), true)
})

Deno.test('paintAccepted lists per-suite continue reasons when explicit count is small', () => {
	const { logs } = captureI18n(() => paintAccepted({
		selectionMode: 'continue',
		goalCount: 2,
		total: 10,
		runCount: 2,
		reuseCount: 0,
		blockedCount: 0,
		continueReasons: [
			{ key: 'shells/social:pure', kind: 'explicit_selected' },
			{ key: 'checks:i18n_keys', kind: 'stale_content', matchedPaths: ['src/public/locales/zh-CN.json'] },
		],
	}))
	assertEquals(logs.some(row => row.key === 'fountConsole.test.continueDefault'), true)
	assertEquals(logs.filter(row => row.key === 'fountConsole.test.display.reason').map(row => row.params.label), [
		'shells/social:pure',
		'checks:i18n_keys',
	])
	assertEquals(logs.some(row => row.key === 'fountConsole.test.display.explicitSelectedCount'), false)
	assertEquals(logs.some(row => row.key === 'fountConsole.test.display.remaining'), false)
})

Deno.test('paintAccepted aggregates explicit_selected over 7 into a count', () => {
	const continueReasons = Array.from({ length: 8 }, (_, index) => ({ key: `suite:${index}`, kind: 'explicit_selected' }))
	continueReasons.push({ key: 'checks:i18n_keys', kind: 'stale_content', matchedPaths: ['src/public/locales/zh-CN.json'] })
	const { logs } = captureI18n(() => paintAccepted({
		selectionMode: 'explicit',
		goalCount: 9,
		total: 20,
		runCount: 9,
		reuseCount: 0,
		blockedCount: 0,
		continueReasons,
	}))
	assertEquals(logs.filter(row => row.key === 'fountConsole.test.display.explicitSelectedCount').map(row => row.params), [
		{ count: 8 },
	])
	assertEquals(logs.filter(row => row.key === 'fountConsole.test.display.reason').map(row => row.params.label), [
		'checks:i18n_keys',
	])
	assertEquals(logs.some(row => row.key === 'fountConsole.test.display.remaining'), false)
})

Deno.test('paintJobDone nothingToContinue after a finished wave', () => {
	const { logs } = captureI18n(() => paintJobDone({
		nothingToContinue: true,
		reportPath: 'data/test/report.md',
		exitCode: 0,
	}))
	assertEquals(logs.map(row => row.key), [
		'fountConsole.test.nothingToContinue',
		'fountConsole.test.reportPathFinal',
		'fountConsole.test.statePathFinal',
	])
})

/**
 * 截获 stdout.write 文本。
 * @param {() => void} fn 回调
 * @returns {string} 写出的文本
 */
function captureStdout(fn) {
	const chunks = []
	const orig = process.stdout.write
	/**
	 * @param {string | Uint8Array} chunk 片段
	 * @returns {boolean} 兼容 write
	 */
	function spy(chunk) {
		chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
		return true
	}
	process.stdout.write = spy
	try {
		fn()
		return chunks.join('')
	}
	finally {
		process.stdout.write = orig
	}
}

Deno.test('paintSuiteEnd overview prints remaining after FAILED without suite output', () => {
	const output = 'Error: achievements page watch locale\n    at smoke.spec.mjs'
	let written = ''
	const { logs } = captureI18n(() => {
		written = captureStdout(() => paintSuiteEnd({
			key: 'shells/achievements:frontend',
			passed: false,
			output,
		}, { stream: false }))
	})
	assertEquals(logs[0]?.key, 'fountConsole.test.failed')
	assertEquals(logs[0]?.params.label, 'shells/achievements:frontend')
	assertEquals(written.includes(output), false)
	assertEquals(logs.some(row => row.key === 'fountConsole.test.display.remaining'), false)
})

Deno.test('paintSuiteEnd stream mode does not replay live output', () => {
	let written = ''
	captureI18n(() => {
		written = captureStdout(() => paintSuiteEnd({
			key: 'checks:text_lf',
			passed: false,
			output: 'already streamed\n',
		}, { stream: true }))
	})
	assertEquals(written, '')
})

Deno.test('formatFailureOutput strips markers and appends trailing newline', () => {
	assertEquals(formatFailureOutput('Error: still failing'), 'Error: still failing\n')
	assertEquals(formatFailureOutput('a\nb\n'), 'a\nb\n')
	assertEquals(formatFailureOutput(''), '')
	assertEquals(formatFailureOutput(`${formatNoiseAllowBegin('.*')}\nError: still failing\n${formatNoiseAllowEnd()}`), 'Error: still failing\n')
})

Deno.test('paintJobDone reprints failed suite logs after the report path', async () => {
	const output = 'Error: still failing\n'
	const { logs } = await captureI18n(async () => {
		await allowNoise('Error: still failing', () => {
			paintJobDone({
				reportPath: 'data/test/report.md',
				exitCode: 1,
				failureLogs: [{ key: 'shells/achievements:frontend', output }],
			})
		})
	})
	assertEquals(logs.at(-1)?.key, 'fountConsole.test.display.failureLog')
	assertEquals(logs.at(-1)?.params.label, 'shells/achievements:frontend')
})

Deno.test('paintJobWait names queue depth not another suite', () => {
	const { logs } = captureI18n(() => paintJobWait({ aheadCount: 3 }))
	assertEquals(logs.map(row => row.key), ['fountConsole.test.display.queued'])
	assertEquals(logs[0]?.params.count, 3)
})

Deno.test('paintJobWait passes aheadCount through without a default', () => {
	const { logs } = captureI18n(() => paintJobWait({}))
	assertEquals(logs[0]?.params.count, undefined)
})

/**
 * 截获仪表盘写入。
 * @param {object} [options] 选项
 * @param {boolean} [options.enabled] 是否启用
 * @returns {{ out: string[], text: () => string, dashboard: TestDashboard }} 句柄
 */
function captureDashboard({ enabled = true } = {}) {
	/** @type {string[]} */
	const out = []
	/**
	 * 记录一次写入。
	 * @param {string} text 文本
	 * @returns {number} push 返回的下标
	 */
	const write = text => out.push(text)
	/**
	 * 已捕获的拼接全文。
	 * @returns {string} 文本
	 */
	const text = () => out.join('')
	const dashboard = new TestDashboard({ write, enabled, throttleMs: 0 })
	return { out, text, dashboard }
}

Deno.test('dashboard disabled emits nothing on begin/events/end', () => {
	const { out, dashboard } = captureDashboard({ enabled: false })
	dashboard.begin()
	dashboard.onSuiteStart({ key: 'checks:i18n_keys', expectedMs: 1000 })
	dashboard.onScheduleUpdate({ running: [], lastCompletionMs: 5000, reason: 'initial' })
	dashboard.onSuiteEnd({ key: 'checks:i18n_keys', passed: true, durationMs: 100, peakMemMb: 10, avgCpuPct: 5 })
	dashboard.end()
	assertEquals(out, [])
})

Deno.test('dashboard exposes enabled getter for the display gate', () => {
	assertEquals(new TestDashboard({ enabled: true }).enabled, true)
	assertEquals(new TestDashboard({ enabled: false }).enabled, false)
})

Deno.test('dashboard begin hides cursor and shows idle header', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	assertEquals(text().includes('\x1b[?25l'), true)
	assertEquals(text().includes('空闲'), true)
	dashboard.end()
})

Deno.test('dashboard renders running suite with progress bar', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteStart({ key: 'shells/chat:pure', expectedMs: 60_000 })
	dashboard.onScheduleUpdate({
		running: [{ key: 'shells/chat:pure', remainingMs: 60_000 }],
		lastCompletionMs: 120_000,
		reason: 'suite_started',
	})
	const out = text()
	assertEquals(out.includes('shells/chat:pure'), true)
	assertEquals(out.includes('░'), true)
	assertEquals(out.includes('已 '), true)
	assertEquals(out.includes('剩余≈'), true)
	dashboard.end()
})

Deno.test('dashboard commits completed suite stats to scrollback', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteStart({ key: 'shells/chat:pure', expectedMs: 60_000 })
	dashboard.onSuiteEnd({
		key: 'shells/chat:pure',
		passed: true,
		durationMs: 61_234,
		peakMemMb: 512,
		avgCpuPct: 42.3,
	})
	const out = text()
	assertEquals(out.includes('✓'), true)
	assertEquals(out.includes('shells/chat:pure'), true)
	assertEquals(out.includes('耗时'), true)
	assertEquals(out.includes('CPU 42%'), true)
	assertEquals(out.includes('内存 512MB'), true)
	dashboard.end()
})

Deno.test('dashboard counts failed suites with memory stats', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteEnd({ key: 'server:live', passed: false, durationMs: 500, peakMemMb: 2048, avgCpuPct: 10 })
	const out = text()
	assertEquals(out.includes('✗'), true)
	assertEquals(out.includes('2.0GB'), true)
	assertEquals(out.includes('失败 1'), true)
	// 失败行名字标红并带终端响铃。
	assertEquals(out.includes('\x1b[31mserver:live\x1b[0m'), true)
	assertEquals(out.includes('\x07'), true)
	dashboard.end()
})

Deno.test('dashboard completed passed line keeps plain name without bell', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteEnd({ key: 'shells/chat:pure', passed: true, durationMs: 1000, peakMemMb: 64, avgCpuPct: 12 })
	const out = text()
	assertEquals(out.includes('\x1b[31m'), false)
	assertEquals(out.includes('\x07'), false)
	assertEquals(out.includes('✓'), true)
	dashboard.end()
})

Deno.test('dashboard commits blocked and reused suites dimly', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteEnd({ key: 'server:live', blockedBy: ['server:pure'] })
	dashboard.onSuiteEnd({ key: 'shells/chat:e2e', reused: true, status: 'passed' })
	const out = text()
	assertEquals(out.includes('阻塞'), true)
	assertEquals(out.includes('复用'), true)
	dashboard.end()
})

Deno.test('dashboard commits long completed result line in full, relying on terminal wrap', () => {
	Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true })
	Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true })
	try {
		const { text, dashboard } = captureDashboard()
		dashboard.begin()
		dashboard.onSuiteEnd({
			key: 'shells/serviceSourceManage:frontend',
			passed: false,
			durationMs: 122_000,
			peakMemMb: 139,
			avgCpuPct: 0,
			noiseHits: ['E01: frontend noise', 'E02: another hit'],
		})
		const out = text()
		// 结果行整行输出，不因列宽截断；折行交给终端。
		assertEquals(out.includes('（噪声：E01: frontend noise, E02: another hit）'), true)
		assertEquals(out.includes('…'), false)
		dashboard.end()
	}
	finally {
		Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true })
		Object.defineProperty(process.stdout, 'rows', { value: undefined, configurable: true })
	}
})

Deno.test('dashboard commits queue events in watch mode', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onQueue({ type: 'queue-append', key: 'server:pure', reason: 'idle_all' })
	dashboard.onQueue({ type: 'queue-remove', key: 'server:pure', reason: 'cli_complete' })
	const out = text()
	assertEquals(out.includes('入队'), true)
	assertEquals(out.includes('移出'), true)
	dashboard.end()
})

Deno.test('dashboard end erases status area and restores cursor', () => {
	const { text, dashboard } = captureDashboard()
	dashboard.begin()
	dashboard.onSuiteStart({ key: 'checks:text_lf', expectedMs: 1000 })
	dashboard.end()
	const out = text()
	assertEquals(out.includes('\x1b[2A\x1b[J'), true)
	assertEquals(out.includes('\x1b[?25h'), true)
})

Deno.test('dashboard width helpers handle ANSI and CJK', () => {
	assertEquals(visibleWidth('abc'), 3)
	assertEquals(visibleWidth('中文'), 4)
	assertEquals(visibleWidth('\x1b[32m✓\x1b[0m'), 1)
})

Deno.test('wrapByWidth folds long lines without dropping content', () => {
	assertEquals(wrapByWidth('abc', 5), ['abc'])
	assertEquals(wrapByWidth('abcdefghij', 5), ['abcde', 'fghij'])
	assertEquals(wrapByWidth('中文测试', 4), ['中文', '测试'])
	// 折行不丢字节，拼接回来仍是原文。
	assertEquals(wrapByWidth('abcdefghij', 5).join(''), 'abcdefghij')
	// ANSI 序列保持完整且按可见宽度折行。
	const [first, second] = wrapByWidth('\x1b[32mabcdefghij\x1b[0m', 5)
	assertEquals(first, '\x1b[32mabcde')
	assertEquals(second, 'fghij\x1b[0m')
	assertEquals(visibleWidth(first), 5)
	assertEquals(visibleWidth(second), 5)
})

Deno.test('unknown bar is a constant-width rightward marquee, not a shrink pulse', () => {
	// 各相位下高亮块长度恒定（向右滑动不伸缩），总格数恒为条宽。
	assertEquals(stripAnsi(renderBar(null, 20, 0)).length, 20)
	assertEquals((stripAnsi(renderBar(null, 20, 0)).match(/█/g) ?? []).length, 7)
	assertEquals((stripAnsi(renderBar(null, 20, 5)).match(/█/g) ?? []).length, 7)
	assertEquals((stripAnsi(renderBar(null, 20, 19)).match(/█/g) ?? []).length, 7)
	assertEquals((stripAnsi(renderBar(null, 5, 0)).match(/█/g) ?? []).length, 3)
	// 确定进度条保持原有行为。
	assertEquals(stripAnsi(renderBar(58, 20, 0)), `${'█'.repeat(12)}${'░'.repeat(8)}`)
	assertEquals(stripAnsi(renderBar(100, 20, 0)), '█'.repeat(20))
})

Deno.test('unknown and known running lines align to the same right edge', () => {
	/**
	 * 渲染一个在跑套件行并返回其剥离 ANSI 后的文本与显示宽度。
	 * @param {number | null} expectedMs 时长基线（null 为未知进度）
	 * @returns {{ plain: string, width: number }} 该行纯文本
	 */
	function runningLine(expectedMs) {
		const { out, dashboard } = captureDashboard()
		const key = 'shells/chat:pure'
		dashboard.begin()
		dashboard.onSuiteStart({ key, expectedMs })
		dashboard.onScheduleUpdate({ running: [{ key, remainingMs: expectedMs }], lastCompletionMs: 120_000, reason: 'suite_started' })
		const lines = out.join('').split('\r\n').map(line => stripAnsi(line)).filter(Boolean)
		dashboard.end()
		const plain = lines.at(-1)
		return { plain, width: visibleWidth(plain) }
	}
	const known = runningLine(60_000)
	const unknown = runningLine(null)
	// 未知后缀恒宽 4（'   ?'），与百分数（'  0%'）对齐，右侧段不整体偏移。
	assertEquals(known.plain.endsWith('%'), true)
	assertEquals(unknown.plain.endsWith('   ?'), true)
	assertEquals(unknown.width, known.width)
})

Deno.test('dashboard move-up count accounts for physical wrap after shrink', () => {
	/**
	 * @param {number | undefined} columns 列数（undefined 恢复默认）
	 * @returns {void}
	 */
	function setCols(columns) {
		Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true })
	}
	Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true })
	setCols(200)
	try {
		const { out, dashboard } = captureDashboard()
		dashboard.begin()
		dashboard.onSuiteStart({ key: 'shells/chat:pure', expectedMs: 60_000 })
		dashboard.onScheduleUpdate({ running: [{ key: 'shells/chat:pure', remainingMs: 60_000 }], lastCompletionMs: 120_000, reason: 'suite_started' })
		// 宽屏渲染后缩窄到 80 列，再触发重绘：上移行数按已渲染行在当前列宽下的精确折行数
		//（头部 1 行 + 进度行约 200 列折成 3 行 = 4）。
		setCols(80)
		dashboard.onScheduleUpdate({ running: [{ key: 'shells/chat:pure', remainingMs: 60_000 }], lastCompletionMs: 120_000, reason: 'suite_started' })
		assertEquals(out.join('').includes('\x1b[4A'), true)
		// 重绘后状态区已按 80 列折行，结束时按新宽度（2 行）擦除。
		dashboard.end()
		assertEquals(out.join('').includes('\x1b[2A\x1b[J\x1b[?25h'), true)
	}
	finally {
		Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true })
		Object.defineProperty(process.stdout, 'rows', { value: undefined, configurable: true })
	}
})
