/**
 * 远程执行流式回显：经 `run_code` + `callback` 通道逐块回传输出（无需 P2P 协议支持）。
 * 远程脚本用 `callback({ execId, stream, data })` 回传；主机侧实现 `interfaces.subfount.RemoteCallBack` 的 part
 * 调用 {@link dispatchRemoteStreamOutput} 按 execId 分派到 {@link withRemoteStreamSink} 注册的回调。
 */

/**
 * 远程流式输出回调注册表：execId → onOutput(stream, data)。
 * @type {Map<string, (stream: 'stdout'|'stderr', data: string) => void>}
 */
const remoteStreamSinks = new Map()

/**
 * 在流式回调注册下运行远程调用，结束后注销。
 * @param {string} execId - 流式分派 id（远程脚本回传用）。
 * @param {(stream: 'stdout'|'stderr', data: string) => void} onOutput - 逐块输出回调。
 * @param {() => Promise<any>} run - 注册期间执行的远程调用。
 * @returns {Promise<any>} run 的结果。
 */
export async function withRemoteStreamSink(execId, onOutput, run) {
	remoteStreamSinks.set(execId, onOutput)
	try { return await run() }
	finally { remoteStreamSinks.delete(execId) }
}

/**
 * 分派远程流式输出到对应执行的 onOutput 回调。
 * @param {{execId?: string, stream?: string, data?: unknown}} payload - 远程 `callback` 负载。
 * @returns {void}
 */
export function dispatchRemoteStreamOutput(payload) {
	const sink = remoteStreamSinks.get(payload?.execId)
	if (!sink) return
	try { sink(payload.stream === 'stderr' ? 'stderr' : 'stdout', String(payload.data)) }
	catch { /* 流式回调失败不影响远程执行 */ }
}

/**
 * 构造远程流式 shell 脚本：在分机上执行命令并逐块经 `callback` 回传输出，超时在分机侧杀进程树。
 * @param {string|null} shell - shell 名（null = 分机默认）。
 * @param {string} code - 命令。
 * @param {string|undefined} cwd - 工作目录（分机本地路径）。
 * @param {number|null} timeoutMs - 超时毫秒（null = 不限时）。
 * @param {string} execId - 流式分派 id。
 * @param {boolean} [cancellable] 是否在分机上登记执行级取消标记（供 {@link remoteShellStopScript} 查询）。
 * @returns {string} 可经 `executeCodeOnSubfount` 执行的脚本。
 */
export function remoteShellStreamScript(shell, code, cwd, timeoutMs, execId, cancellable = false) {
	return `\
const stopped = ${cancellable ? 'globalThis[Symbol.for(\'fount.remote-shell-stops\')] ??= new Set()' : 'null'}
if (stopped) stopped.add(${JSON.stringify(execId)})
let spawned = null
let pendingTermination = null
async function terminate(child) {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return null
	if (process.platform === 'win32') {
		const { execFile } = await import('npm:@steve02081504/exec')
		const result = await execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(error => ({ error }))
		if (result.error) return result.error
		return result.code === 0 ? null : new Error('taskkill failed with exit code ' + result.code)
	}
	try { process.kill(-child.pid, 'SIGKILL'); return null }
	catch (groupError) {
		try { child.kill('SIGKILL'); return null }
		catch (killError) { return new AggregateError([groupError, killError], 'Failed to terminate remote shell process') }
	}
}
try {
const { exec, shell_exec_map } = await import('npm:@steve02081504/exec')
const shellName = ${JSON.stringify(shell || null)}
const command = ${JSON.stringify(code)}
const timeoutMs = ${JSON.stringify(timeoutMs)}
const cwd = ${JSON.stringify(cwd || null)}
const emit = payload => { try { callback(payload) } catch { /* ignore */ } }
const cancelled = stopped ? stopped.has(${JSON.stringify(execId)}) : false
if (shellName && !shell_exec_map[shellName]) throw new Error('Unsupported shell: ' + shellName)
const start = Date.now()
if (cancelled) return { code: null, signal: 'SIGKILL', stdout: '', stderr: '', stdall: '', timedOut: false, cancelled: true, elapsedMs: 0 }
let timedOut = false
const options = {
	no_ansi_terminal_sequences: true,
	...cwd ? { cwd } : {},
	on_spawn: child => { spawned = child; if (timedOut || cancelled) pendingTermination = terminate(child) },
	on_stdout: data => emit({ execId: ${JSON.stringify(execId)}, stream: 'stdout', data }),
	on_stderr: data => emit({ execId: ${JSON.stringify(execId)}, stream: 'stderr', data }),
}
if (process.platform !== 'win32') options.detached = true
const run = Promise.resolve(shellName ? shell_exec_map[shellName](command, options) : exec(command, options))
run.catch(() => { })
const settle = () => run.then(
	result => ({ result, timedOut: false }),
	error => ({ result: error, timedOut: false })
)
const finish = outcome => {
	const elapsedMs = Date.now() - start
	if (outcome.result instanceof Error) throw Object.assign(outcome.result, { timedOut: outcome.timedOut, elapsedMs })
	return { ...outcome.result, timedOut: outcome.timedOut, elapsedMs }
}
/**
 * 轮询停止标记；进程未启动时也会立即返回，随后由调用方确认未 spawn。
 * @param {Set<string>} stopped 停止标记集合。
 * @param {string} execId 执行 id。
 * @returns {Promise<void>} 标记出现即完成。
 */
async function waitForStop(stopped, execId) {
	while (!stopped.has(execId)) await new Promise(resolve => setTimeout(resolve, 50))
}
if (cancelled) return { code: null, signal: 'SIGKILL', stdout: '', stderr: '', stdall: '', timedOut: false, cancelled: true, elapsedMs: 0 }
if (stopped) {
	let stopTimer
	const interrupted = await Promise.race([
		waitForStop(stopped, ${JSON.stringify(execId)}).then(() => true),
		run.then(() => false, () => false),
		...(timeoutMs == null ? [] : [new Promise(resolve => { stopTimer = setTimeout(() => resolve(false), timeoutMs) })]),
	])
	clearTimeout(stopTimer)
	// 取消与自然结束同时发生时以自然结果为准（stop 标记留给 finally 清理）。
	if (interrupted) {
		const terminationError = await terminate(spawned) ?? await pendingTermination
		if (terminationError) throw terminationError
		return { code: null, signal: 'SIGKILL', stdout: '', stderr: '', stdall: '', timedOut: false, cancelled: true, elapsedMs: Date.now() - start }
	}
}
if (timeoutMs == null) return finish(await settle())
if (Date.now() - start >= timeoutMs) return finish(await settle())
timedOut = true
let terminationError = await terminate(spawned)
let graceTimer
const settled = await Promise.race([
	run.then(result => ({ result }), error => ({ result: error })),
	new Promise(resolve => { graceTimer = setTimeout(() => resolve(null), 5000) }),
])
clearTimeout(graceTimer)
if (pendingTermination) terminationError ??= await pendingTermination
if (!settled)
	throw Object.assign(
		terminationError ?? new Error('Remote shell process was not confirmed terminated within the grace period'),
		{ timedOut: true, elapsedMs: Date.now() - start }
	)
return finish({ result: settled.result, timedOut: true })
} finally { stopped?.delete(${JSON.stringify(execId)}) }
`
}

/**
 * 查询分机上某次执行是否已被登记（登记后任意时刻打标记即可取消，进程未启动也有效）。
 * @param {string} execId 执行 id。
 * @returns {string} 返回布尔值的远程脚本。
 */
export function remoteShellStopScript(execId) {
	return `return globalThis[Symbol.for('fount.remote-shell-stops')]?.has(${JSON.stringify(execId)}) ?? false`
}

/**
 * 构造远程流式 JS 脚本：在分机上构造 `VirtualConsole` 传入 `async_eval`，逐条经 `callback` 回传 console 输出。
 * @param {string} code - AI 的 JS 代码。
 * @param {string} execId - 流式分派 id。
 * @returns {string} 可经 `executeCodeOnSubfount` 执行的脚本。
 */
export function remoteJsStreamScript(code, execId) {
	return `\
const { async_eval } = await import('npm:@steve02081504/async-eval')
const { VirtualConsole } = await import('npm:@steve02081504/virtual-console')
const vc = new VirtualConsole({ realConsoleOutput: false })
vc.addLogEntryListener(entry => { try { callback({ execId: ${JSON.stringify(execId)}, stream: entry.level === 'error' || entry.level === 'warn' || entry.level === 'stderr' ? 'stderr' : 'stdout', data: entry.toString() }) } catch { /* ignore */ } })
const result = await async_eval(${JSON.stringify(code)}, { console: vc })
if (result.error) throw result.error
return result.result
`
}
