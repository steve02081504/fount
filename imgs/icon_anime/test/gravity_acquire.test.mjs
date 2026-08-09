/**
 * gravity_acquire：termux-sensor stdout / JSON 解析 / 退出释放。
 *
 * SensorAPI：流式监听把 listener 挂在 Termux:API 进程里；仅 kill CLI
 * 会弄断 socket 并把 outputWriter 置空，却不 unregisterListener。
 * 之后再 `termux-sensor -c` 会走 “cleanup unnecessary” 分支，传感器一直占着
 * ——表现为要强杀 Termux + Termux:API 才恢复。正确停法：先 -c 再 kill。
 */
/* global Deno */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert'

import {
	parseSensorStdout, valuesFromSensorJson, start as startTermuxAcquire,
} from '../gravity_acquire/termux.mjs'

Deno.test('gravity_acquire: pretty-printed termux-sensor stream (indent=2)', () => {
	// SensorAPI: sensorReadout.toString(INDENTATION) + "\n"
	const chunk = `{
  "BMI160 Gravity": {
    "values": [
      0.5,
      -9.7,
      1.2
    ]
  }
}
`
	const { samples, rest } = parseSensorStdout(chunk + chunk.slice(0, 20))
	assertEquals(samples.length, 1)
	assertAlmostEquals(samples[0][0], 0.5, 1e-9)
	assertAlmostEquals(samples[0][1], -9.7, 1e-9)
	assertAlmostEquals(samples[0][2], 1.2, 1e-9)
	assertEquals(rest.startsWith('{'), true)
	const again = parseSensorStdout(rest + chunk.slice(20))
	assertEquals(again.samples.length, 1)
	assertEquals(again.rest, '')
})

Deno.test('gravity_acquire: compact + concatenated sensor objects', () => {
	const firstPayload = '{"Gravity":{"values":[1,2,3]}}'
	const secondPayload = '{"accelerometer":{"values":[4,5,6]}}'
	const { samples, rest } = parseSensorStdout(firstPayload + secondPayload)
	assertEquals(samples, [[1, 2, 3], [4, 5, 6]])
	assertEquals(rest, '')
})

Deno.test('gravity_acquire: valuesFromSensorJson skips short values arrays', () => {
	assertEquals(valuesFromSensorJson({ empty: { values: [1] } }), null)
	assertEquals(valuesFromSensorJson({ Gravity: { values: [1, 2, 3] } }), [1, 2, 3])
})

/**
 * @returns {{
 *   calls: unknown[],
 *   stop: () => void,
 *   fireExit: () => void,
 * }} 记录调用顺序的 harness
 */
const mockTermuxLifecycle = () => {
	/** @type {unknown[]} */
	const calls = []
	/** @type {(() => void) | null} */
	let exitListener = null
	const fakeChild = {
		stdout: {
			/**
			 *
			 */
			setEncoding() { /* noop */ },
			/**
			 *
			 */
			on() { /* noop */ },
			/**
			 *
			 */
			removeAllListeners() { /* noop */ },
		},
		/**
		 *
		 */
		on() { /* noop */ },
		/**
		 *
		 */
		removeAllListeners() { /* noop */ },
		/**
		 *
		 */
		kill() { calls.push('kill') },
	}
	const stop = startTermuxAcquire(() => { /* noop */ }, {
		/**
		 *
		 * @param cmd
		 * @param args
		 */
		spawn: (cmd, args) => {
			calls.push(['spawn', cmd, ...args])
			return fakeChild
		},
		/**
		 *
		 * @param cmd
		 * @param args
		 */
		spawnSync: (cmd, args) => {
			calls.push(['spawnSync', cmd, ...args])
			return { status: 0 }
		},
		process: {
			/**
			 *
			 * @param event
			 * @param listener
			 */
			on(event, listener) {
				if (event === 'exit') exitListener = listener
			},
			/**
			 *
			 * @param event
			 * @param listener
			 */
			off(event, listener) {
				if (event === 'exit' && exitListener === listener) exitListener = null
			},
		},
	})
	return {
		calls,
		stop,
		/**
		 *
		 */
		fireExit: () => {
			exitListener?.()
		},
	}
}

/**
 * @param {unknown[]} calls 调用记录
 * @returns {void}
 */
const assertCleanupBeforeKill = (calls) => {
	const cleanupAt = calls.findIndex(entry =>
		Array.isArray(entry) && entry[0] === 'spawnSync' && entry[1] === 'termux-sensor' && entry[2] === '-c')
	const killAt = calls.findIndex(entry => entry === 'kill')
	assertEquals(cleanupAt >= 0, true, 'expected termux-sensor -c')
	assertEquals(killAt >= 0, true, 'expected child kill')
	assertEquals(cleanupAt < killAt, true, 'SensorAPI requires -c before kill')
}

Deno.test('gravity_acquire: stop runs termux-sensor -c before kill', () => {
	const { calls, stop } = mockTermuxLifecycle()
	const spawnAt = calls.findIndex(entry =>
		Array.isArray(entry) && entry[0] === 'spawn' && entry[1] === 'termux-sensor')
	assertEquals(spawnAt >= 0, true)
	calls.length = 0
	stop()
	assertCleanupBeforeKill(calls)
})

Deno.test('gravity_acquire: process exit still releases sensors before kill', () => {
	const { calls, fireExit } = mockTermuxLifecycle()
	calls.length = 0
	fireExit()
	assertCleanupBeforeKill(calls)
})
