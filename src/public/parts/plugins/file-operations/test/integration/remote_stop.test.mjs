/* global Deno */
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import { async_eval } from 'npm:@steve02081504/async-eval'

import { remoteShellStopScript, remoteShellStreamScript } from '../../src/remote_stream.mjs'

const shell = Deno.build.os === 'windows' ? 'powershell' : 'sh'

/**
 * 在接收方进程中执行取消 RPC。
 * @param {string} id 执行 id。
 * @returns {Promise<boolean>} 接收方是否找到并中止了该执行。
 */
async function stop(id) {
	const result = await async_eval(remoteShellStopScript(id))
	if (result.error) throw result.error
	return result.result
}

/**
 * 等待就绪，避免依赖 shell 冷启动耗时。
 * @param {Function} predicate Readiness check.
 * @returns {Promise<void>} Readiness completion.
 */
async function waitFor(predicate) {
	const deadline = Date.now() + 10000
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Remote shell readiness timed out')
		await new Promise(resolve => setTimeout(resolve, 20))
	}
}

Deno.test('remote stop terminates a running process tree and releases its handle', async () => {
	const id = crypto.randomUUID()
	const chunks = []
	const command = shell === 'sh' ? 'echo before; sh -c \'sleep 30; echo after\'' : 'Write-Output before; powershell -NoProfile -Command \'Start-Sleep -Seconds 30; Write-Output after\''
	const running = async_eval(remoteShellStreamScript(shell, command, undefined, 15000, id, true), {
		/**
		 * 收集流式输出。
		 * @param {object} payload Output payload.
		 * @returns {number} Output count.
		 */
		callback: payload => chunks.push(payload.data),
	})
	try {
		await waitFor(() => chunks.join('').includes('before'))
		assertEquals(await stop(crypto.randomUUID()), false)
		assertEquals(await stop(id), true)
		const outcome = await running
		const result = outcome.error ?? outcome.result
		assert(result.signal || result.code || outcome.error, 'Stopped execution must not report success')
		assert(!chunks.join('').includes('after'))
		assertEquals(await stop(id), false, 'Completed handle must be released')
	} finally { await stop(id); await running }
})

Deno.test('non-streamed remote execution can be stopped before spawn', async () => {
	const id = crypto.randomUUID()
	let release
	const spawnGate = new Promise(resolve => { release = resolve })
	const command = shell === 'sh' ? 'sleep 30' : 'Start-Sleep -Seconds 30'
	// Pause before loading the executor to make the startup cancellation race deterministic.
	const script = remoteShellStreamScript(shell, command, undefined, 10000, id, true)
		.replace('try {\nconst { exec, shell_exec_map }', 'try {\nawait spawnGate;\nconst { exec, shell_exec_map }')
	const running = async_eval(script, { spawnGate })
	try {
		await waitFor(() => globalThis[Symbol.for('fount.remote-shell-stops')]?.get(id))
		assertEquals(await stop(id), true)
		release()
		const outcome = await running
		const result = outcome.error ?? outcome.result
		assert(result.signal || result.code || outcome.error)
		assertEquals(await stop(id), false)
	} finally { release(); await stop(id); await running }
})

Deno.test('remote stop handles clean up after natural completion and startup errors', async () => {
	const id = crypto.randomUUID()
	const command = shell === 'sh' ? 'echo done' : 'Write-Output done'
	const result = await async_eval(remoteShellStreamScript(shell, command, undefined, null, id, true))
	if (result.error) throw result.error
	assertStringIncludes(result.result.stdall, 'done')
	assertEquals(await stop(id), false)
	const invalid = crypto.randomUUID()
	const failed = await async_eval(remoteShellStreamScript('unknown-shell', '', undefined, null, invalid, true))
	assert(failed.error)
	assertEquals(await stop(invalid), false)
})
