/**
 * 内核在有 suite 在跑时阻止主机休眠；空闲释放。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import process from 'node:process'

let held = false
/** @type {{ symbols: { SetThreadExecutionState: (flags: number) => number } } | null} */
let kernel32 = null
/** @type {import('node:child_process').ChildProcess | null} */
let unixProcess = null

/**
 * @param {boolean} shouldKeepAwake 是否持有
 * @returns {void}
 */
export function setTestKeepAwake(shouldKeepAwake) {
	if (process.env.FOUNT_TEST_ALLOW_SLEEP) {
		if (held) release()
		return
	}
	if (shouldKeepAwake === held) return
	if (shouldKeepAwake) acquire()
	else release()
}

/** 持有。 */
function acquire() {
	held = true
	if (process.platform === 'win32') {
		try {
			kernel32 ??= Deno.dlopen('kernel32.dll', {
				SetThreadExecutionState: { parameters: ['u32'], result: 'u32' },
			})
			kernel32.symbols.SetThreadExecutionState(0x80000001)
		}
		catch { /* 无 FFI */ }
		return
	}
	try {
		unixProcess = process.platform === 'darwin'
			? spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' })
			: spawn('systemd-inhibit', [
				'--what=idle:sleep:handle-lid-switch',
				'--who=fount-test-kernel',
				'--why=fount test running',
				'--mode=block',
				'sleep', 'infinity',
			], { stdio: 'ignore' })
	}
	catch { /* 无 caffeinate / systemd-inhibit */ }
}

/** 释放。 */
function release() {
	held = false
	if (process.platform === 'win32') {
		try {
			kernel32?.symbols.SetThreadExecutionState(0x80000000)
		}
		catch { /* ignore */ }
		return
	}
	unixProcess?.kill()
	unixProcess = null
}
