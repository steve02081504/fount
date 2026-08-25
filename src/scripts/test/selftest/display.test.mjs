/**
 * 显示层：空默认波次必须说出「无需再跑」，不能静默 exit 0。
 */
/* global Deno */
import process from 'node:process'

import { assertEquals } from 'jsr:@std/assert'

import { console } from '../../i18n/bare.mjs'
import { allowNoise } from '../core/allowNoise.mjs'
import { formatNoiseAllowBegin, formatNoiseAllowEnd } from '../core/output_filter.mjs'
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
	const result = fn()
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
