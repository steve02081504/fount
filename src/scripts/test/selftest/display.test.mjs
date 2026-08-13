/**
 * 显示层：空默认波次必须说出「无需再跑」，不能静默 exit 0。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { console } from '../../i18n/bare.mjs'
import { paintAccepted, paintJobDone } from '../display/paint.mjs'
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
	console.logI18n = logSpy
	console.errorI18n = errSpy
	try {
		fn()
	}
	finally {
		console.logI18n = logOrig
		console.errorI18n = errOrig
	}
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
