/**
 * shell / JS 执行护栏（后端共享，无 UI 依赖）。
 * - 超时：shell 到点杀进程树；JS 因在进程内无法强杀，只能 race 后如实告知仍在运行。
 * - 大输出：只保留开头 + 结尾，完整内容落盘到系统临时目录并返回路径。
 * 供 code-execution 插件、code shell 与 subfounts 共用。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import util from 'node:util'

import { exec, execFile, shell_exec_map } from 'npm:@steve02081504/exec'

import { ms } from './ms.mjs'

/** shell 默认超时（毫秒）。 */
export const SHELL_DEFAULT_TIMEOUT_MS = ms('3m')
/** JS 默认超时（毫秒）。 */
export const JS_DEFAULT_TIMEOUT_MS = ms('3m')
/** 输出护栏：超过该字符数即截断。 */
export const OUTPUT_GUARD_LIMIT = 20_000
/** 截断后保留的开头字符数。 */
export const OUTPUT_GUARD_HEAD = 8_000
/** 截断后保留的结尾字符数。 */
export const OUTPUT_GUARD_TAIL = 8_000
/** 超时杀进程后等待其真正退出的宽限（毫秒）。 */
export const KILL_GRACE_MS = 5_000
/** 临时输出目录（相对系统临时目录）。 */
export const TEMP_OUTPUT_REL = path.join('fount', 'tool-output')
/** 临时输出保留时长（毫秒）。 */
export const TEMP_RETENTION_MS = ms('3d')

/** 上次清理临时输出目录的时间戳。 */
let lastTempCleanup = 0

/**
 * 将时长字符串解析为毫秒。支持 `ms` / `s`（缺省）/ `m` / `h` 后缀。
 * @param {unknown} value - 属性值。
 * @returns {number|null} 毫秒数；无法解析时为 null。
 */
export function parseDuration(value) {
	if (value === undefined || value === null || value === '') return null
	const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i)
	if (!match) return null
	const amount = Number.parseFloat(match[1])
	if (!Number.isFinite(amount)) return null
	const unit = (match[2] || 's').toLowerCase()
	const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000
	return Math.max(0, Math.round(amount * factor))
}

/**
 * 解析 `<run-*>` / `<run-js>` 标签属性中的运行限制。
 * - `expect`（或别名 `timeout`）为预期时长，`tolerance` 为容错时长，有效超时 = 两者相加。
 * - 只给 `tolerance` 时基于默认值累加。
 * - `wait="forever"`（或 `timeout="forever"` / `timeout="none"` / `no-timeout="true"`）表示不限时干等。
 * @param {Record<string, string>} [attrs] - 标签属性表。
 * @param {number} [defaultMs=SHELL_DEFAULT_TIMEOUT_MS] - 未显式指定时的默认超时。
 * @returns {{timeoutMs: number|null, expectMs: number|null, toleranceMs: number, waitForever: boolean, explicit: boolean}} 运行限制。
 */
export function parseRunLimits(attrs = {}, defaultMs = SHELL_DEFAULT_TIMEOUT_MS) {
	/**
	 * 判断属性值是否表示“无限等待”。
	 * @param {unknown} value - 属性值。
	 * @returns {boolean} 是否无限等待。
	 */
	const isForever = value => ['forever', 'inf', 'infinite', 'none'].includes(String(value ?? '').trim().toLowerCase())
	const waitForever = String(attrs.wait ?? '').trim().toLowerCase() === 'forever'
		|| String(attrs.wait ?? '').trim().toLowerCase() === 'true'
		|| isForever(attrs.timeout)
		|| String(attrs['no-timeout'] ?? '').trim().toLowerCase() === 'true'
	if (waitForever) return { timeoutMs: null, expectMs: null, toleranceMs: 0, waitForever: true, explicit: true }

	const rawTolerance = parseDuration(attrs.tolerance)
	const expectMs = parseDuration(attrs.expect ?? attrs.timeout)
	const toleranceMs = rawTolerance ?? 0
	const explicit = expectMs !== null || rawTolerance !== null
	const base = expectMs ?? defaultMs
	return { timeoutMs: base + toleranceMs, expectMs, toleranceMs, waitForever: false, explicit }
}

/**
 * 将毫秒格式化为人类可读的耗时文本。
 * @param {number} ms - 毫秒数。
 * @returns {string} 如 `820ms` / `3.21s`；无效时为空串。
 */
export function formatElapsed(ms) {
	if (!Number.isFinite(ms) || ms < 0) return ''
	if (ms < 1000) return `${Math.round(ms)}ms`
	return `${(ms / 1000).toFixed(2)}s`
}

/**
 * 对文本做头尾截断（纯函数，不落盘）。
 * @param {string} text - 原始文本。
 * @param {{limit?: number, head?: number, tail?: number}} [options] - 截断参数。
 * @returns {{text: string, truncated: boolean, omitted: number}} 截断后的文本已含尾部片段；`omitted` 为省略字符数。
 */
export function truncateOutput(text, options = {}) {
	const { limit = OUTPUT_GUARD_LIMIT, head = OUTPUT_GUARD_HEAD, tail = OUTPUT_GUARD_TAIL } = options
	const value = String(text ?? '')
	if (value.length <= limit) return { text: value, truncated: false, omitted: 0 }
	return {
		text: value.slice(0, head) + '\n' + value.slice(value.length - tail),
		truncated: true,
		omitted: Math.max(0, value.length - head - tail),
	}
}

/**
 * 清理临时输出目录中过期的文件（尽力而为，节流执行）。
 * @returns {void}
 */
function cleanupTempDir() {
	const now = Date.now()
	if (now - lastTempCleanup < ms('10m')) return
	lastTempCleanup = now
	const dir = path.join(os.tmpdir(), TEMP_OUTPUT_REL)
	fs.promises.readdir(dir).then(async names => {
		for (const name of names) try {
			const file = path.join(dir, name)
			const stat = await fs.promises.stat(file)
			if (stat.isFile() && now - stat.mtimeMs > TEMP_RETENTION_MS)
				await fs.promises.rm(file, { force: true })
		} catch { /* 单个文件失败忽略 */ }
	}).catch(() => { })
}

/**
 * 将完整输出写入系统临时目录，返回绝对路径。
 * @param {string} name - 文件名提示（会做安全化处理）。
 * @param {string} text - 完整内容。
 * @returns {Promise<string>} 临时文件绝对路径。
 */
export async function writeTempOutput(name, text) {
	const safe = String(name || 'output').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'output'
	const dir = path.join(os.tmpdir(), TEMP_OUTPUT_REL)
	await fs.promises.mkdir(dir, { recursive: true })
	const file = path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}.txt`)
	await fs.promises.writeFile(file, String(text ?? ''), 'utf-8')
	cleanupTempDir()
	return file
}

/**
 * 输出护栏：超限时保留头尾、完整内容落盘并在中间插入路径提示。
 * @param {string} text - 完整输出文本。
 * @param {{name?: string, label?: string, writeTemp?: (name: string, text: string) => Promise<string>}} [options] - 选项。
 * @returns {Promise<{text: string, truncated: boolean, omitted: number, savedPath: string|null}>} 护栏结果。
 */
export async function guardOutput(text, options = {}) {
	const { name = 'output', label = '输出', writeTemp = writeTempOutput } = options
	const value = String(text ?? '')
	if (value.length <= OUTPUT_GUARD_LIMIT) return { text: value, truncated: false, omitted: 0, savedPath: null }
	const omitted = value.length - OUTPUT_GUARD_HEAD - OUTPUT_GUARD_TAIL
	let savedPath = null
	try { savedPath = await writeTemp(name, value) } catch { savedPath = null }
	const notice = savedPath
		? `\n…[已省略中间 ${omitted} 字符（${label}过大）；完整内容已保存到：${savedPath}\n可用 <view-file> 分页查看（该文件在 fount 主机上，跨机查看请加 machine="0"）、<grep> 搜索匹配行，或直接读取该文件]…\n`
		: `\n…[已省略中间 ${omitted} 字符（${label}过大；本次未能落盘）]…\n`
	return {
		text: value.slice(0, OUTPUT_GUARD_HEAD) + notice + value.slice(value.length - OUTPUT_GUARD_TAIL),
		truncated: true,
		omitted,
		savedPath,
	}
}

/**
 * 结束进程树：win32 用 `taskkill /T /F`，其余平台杀进程组（回退到直接 kill）。
 * @param {import('node:child_process').ChildProcess|null} child - 已 spawn 的子进程。
 * @returns {Promise<void>}
 */
export async function killProcessTree(child) {
	const pid = child?.pid
	if (!pid) return
	if (process.platform === 'win32') {
		await execFile('taskkill', ['/pid', String(pid), '/T', '/F']).catch(() => { })
		return
	}
	try { process.kill(-pid, 'SIGKILL') }
	catch { try { child.kill('SIGKILL') } catch { /* ignore */ } }
}

/**
 * 执行 shell 命令并施加超时（到点杀进程树）。
 * @param {string|null} shell - shell 名；null 表示平台默认。
 * @param {string} code - 命令。
 * @param {object} [options] - 透传给 exec 的选项。
 * @param {number|null} [timeoutMs] - 超时毫秒；null 表示不限时。
 * @returns {Promise<{result: any, timedOut: boolean, elapsedMs: number}>} 结果（`result` 可能是 Error）、是否超时与耗时。
 */
export async function execShellWithTimeout(shell, code, options = {}, timeoutMs = SHELL_DEFAULT_TIMEOUT_MS) {
	const start = Date.now()
	/** @type {import('node:child_process').ChildProcess|null} */
	let child = null
	const userOnSpawn = options?.on_spawn
	const spawnOptions = {
		...options,
		/**
		 * 记录 spawn 出的子进程并转发调用方的 on_spawn。
		 * @param {import('node:child_process').ChildProcess} spawned - 子进程。
		 * @returns {void}
		 */
		on_spawn: spawned => { child = spawned; userOnSpawn?.(spawned) },
	}
	if (process.platform !== 'win32' && spawnOptions.detached === undefined)
		spawnOptions.detached = true

	let run
	try {
		run = Promise.resolve(shell ? shell_exec_map[shell](code, spawnOptions) : exec(code, spawnOptions))
	}
	catch (error) {
		return { result: error, timedOut: false, elapsedMs: Date.now() - start }
	}
	run.then(() => { }, () => { })

	/**
	 * 将 exec 的 settled 结果归一为带耗时的返回。
	 * @returns {Promise<{result: any, timedOut: boolean, elapsedMs: number}>} 归一结果。
	 */
	const settle = () => run.then(
		result => ({ result, timedOut: false, elapsedMs: Date.now() - start }),
		error => ({ result: error, timedOut: false, elapsedMs: Date.now() - start })
	)

	if (timeoutMs === null) return await settle()

	let timer
	const timedOut = await Promise.race([
		run.then(() => false, () => false),
		new Promise(resolve => { timer = setTimeout(() => resolve(true), Math.max(0, timeoutMs)) }),
	])
	clearTimeout(timer)
	if (!timedOut) return await settle()

	await killProcessTree(child)
	const settled = await Promise.race([
		run.then(result => ({ result }), error => ({ result: error })),
		new Promise(resolve => setTimeout(() => resolve(null), KILL_GRACE_MS)),
	])
	const result = settled?.result ?? { code: null, signal: 'SIGKILL', stdout: '', stderr: '', stdall: '' }
	return { result, timedOut: true, elapsedMs: Date.now() - start }
}

/**
 * 创建收集型 console：记录输出供超时后回读，同时经 `process.stdout/stderr` 转发真实输出（不经 console 代理，避免递归）。
 * @returns {{console: object, text: () => string}} 收集器与其文本读取函数。
 */
export function createCollectingConsole() {
	/** @type {string[]} */
	const lines = []
	/**
	 * 记录一条日志并转发。
	 * @param {'stdout'|'stderr'} channel - 输出通道。
	 * @param {unknown[]} args - 参数。
	 * @returns {void}
	 */
	const push = (channel, args) => {
		const text = util.format(...args)
		lines.push(text)
		try { (channel === 'stderr' ? process.stderr : process.stdout).write(text + '\n') }
		catch { /* ignore */ }
	}
	/** @type {Record<string, (...args: unknown[]) => void>} */
	const consoleObj = {}
	for (const level of ['log', 'info', 'debug', 'dir'])
		/**
		 * 将日志转发并记录为 stdout。
		 * @param {...unknown} args - 参数。
		 * @returns {void}
		 */
		consoleObj[level] = (...args) => push('stdout', args)
	for (const level of ['warn', 'error', 'trace'])
		/**
		 * 将日志转发并记录为 stderr。
		 * @param {...unknown} args - 参数。
		 * @returns {void}
		 */
		consoleObj[level] = (...args) => push('stderr', args)
	return {
		console: consoleObj,
		/**
		 * 读取已捕获的输出文本。
		 * @returns {string} 已捕获输出的换行拼接。
		 */
		text: () => lines.join('\n'),
	}
}

/**
 * 以超时 race 执行一次 JS 求值（JS 在进程内运行，超时后无法强杀）。
 * @param {() => Promise<any>} runEval - 返回求值结果的函数（内部应已捕获错误，不抛出）。
 * @param {number|null} timeoutMs - 超时毫秒；null 表示不限时。
 * @returns {Promise<{evalResult: any, timedOut: boolean, elapsedMs: number}>} 求值结果（超时时为 null）、是否超时与耗时。
 */
export async function runJsWithTimeout(runEval, timeoutMs = JS_DEFAULT_TIMEOUT_MS) {
	const start = Date.now()
	if (timeoutMs === null) {
		const evalResult = await runEval()
		return { evalResult, timedOut: false, elapsedMs: Date.now() - start }
	}
	let timer
	const outcome = await Promise.race([
		Promise.resolve().then(runEval).then(evalResult => ({ evalResult }), error => ({ evalResult: { error } })),
		new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), Math.max(0, timeoutMs)) }),
	])
	clearTimeout(timer)
	if (outcome === 'timeout') return { evalResult: null, timedOut: true, elapsedMs: Date.now() - start }
	return { evalResult: outcome.evalResult, timedOut: false, elapsedMs: Date.now() - start }
}

/**
 * 生成超时提示文案。
 * @param {{timedOut: boolean, elapsedMs: number, waitForever: boolean, expectMs: number|null, toleranceMs: number, kind: 'shell'|'js', killed?: boolean, remote?: boolean}} info - 超时信息。
 * @returns {string} 提示文案（未超时时为空串）。
 */
export function formatTimeoutNotice(info) {
	if (!info.timedOut) return ''
	const waited = formatElapsed(info.elapsedMs)
	const limit = info.expectMs !== null
		? `${formatElapsed(info.expectMs)} + 容错 ${formatElapsed(info.toleranceMs)}`
		: `默认 ${formatElapsed(SHELL_DEFAULT_TIMEOUT_MS)}`
	if (info.kind === 'js')
		return `\n注意：JS 在进程内运行，无法强制终止，本次虽已超时（等待 ${waited}，限制 ${limit}）但代码实际上可能仍在后台运行。如需长任务，请改用 shell 或 callback 异步反馈。`
	if (info.remote && info.killed === false)
		return `\n注意：远端 shell 命令已超时（等待 ${waited}，限制 ${limit}）；未能获取远端进程 pid，无法确认已终止，远端命令可能仍在运行。若需更长时间，可增加 expect/tolerance，或使用 wait="forever" 强制干等。`
	return `\n注意：shell 命令已超时（等待 ${waited}，限制 ${limit}），已尝试终止其进程树。若需更长时间，可增加 expect/tolerance，或使用 wait="forever" 强制干等。`
}
