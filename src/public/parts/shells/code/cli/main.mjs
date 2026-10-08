import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { geti18n } from '../../../../../scripts/i18n/bare.mjs'

import { parseCodeArgs, CLI_HELP, resolveCodeOutputFormat } from './args.mjs'
import { createCodeClient } from './client.mjs'
import { PrintCollector } from './transcript.mjs'
import { createTransport } from './transport.mjs'

/**
 * 写出一行文本；缺少末尾换行时补一个。
 * @param {NodeJS.WritableStream} stream - 目标流。
 * @param {unknown} value - 待写入内容。
 * @returns {unknown} 目标流的写入结果。
 */
const writeLine = (stream, value) => {
	const text = String(value)
	return stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

/**
 * 读尽 stdin，用于 `--prompt-file -`。
 * @param {AsyncIterable<string|Uint8Array>} stdin - 标准输入。
 * @param {AbortSignal} [signal] - 可取消的读取信号。
 * @returns {Promise<string>} 读取到的文本。
 */
export async function readStdin(stdin, signal) {
	let text = ''
	const decoder = new TextDecoder()
	const iterator = stdin[Symbol.asyncIterator]()
	let rejectAbort
	const aborted = new Promise((_, reject) => { rejectAbort = reject })
	/** @returns {void} 取消挂起的读取。 */
	const onAbort = () => rejectAbort(signal.reason)
	signal?.addEventListener('abort', onAbort, { once: true })
	try {
		while (true) {
			signal?.throwIfAborted()
			const next = await Promise.race([iterator.next(), aborted])
			if (next.done) break
			text += typeof next.value === 'string' ? decoder.decode() + next.value : decoder.decode(next.value, { stream: true })
		}
		return text + decoder.decode()
	}
	finally { signal?.removeEventListener('abort', onAbort); if (signal?.aborted) void iterator.return?.().catch(() => { }) }
}

/**
 * code CLI 的客户端入口：解析参数、连服务端，并按终端能力选择 TUI 或 print。
 * @param {object} [root0] - 调用方上下文与本地资源。
 * @param {string[]} [root0.args] - 客户端参数（`fount run code` 之后的部分）。
 * @param {object} [root0.data] - 服务端准备的用户、工作区与认证数据；`usageError` 表示参数在工作区准备阶段被拒。
 * @param {NodeJS.ReadableStream} [root0.stdin] - 标准输入。
 * @param {NodeJS.WriteStream} [root0.stdout] - 标准输出（print 只写本轮日志）。
 * @param {NodeJS.WriteStream} [root0.stderr] - 标准错误（会话 ID、runId 与诊断）。
 * @param {boolean} [root0.isTTY] - 调用方判定的终端能力；省略时按流自述判断。
 * @param {string} [root0.cwd] - 调用目录，用于解析 `--prompt-file` 与 `--workspace` 相对路径。
 * @param {AbortSignal} [root0.signal] - 调用方中断信号。
 * @param {(callback: () => (void|Promise<void>)) => void} [root0.onCleanup] - 清理登记函数。
 * @param {number} [root0.ipcPort] - IPC 端口，用于认证续期。
 * @returns {Promise<number>} 进程退出码：0 成功、1 失败、2 用法错误、130 用户中断。
 */
export async function Run({ args = [], data = {}, stdin = process.stdin, stdout = process.stdout,
	stderr = process.stderr, isTTY, cwd = process.cwd(), signal, onCleanup = () => { }, ipcPort }) {
	let parsed
	try { parsed = parseCodeArgs(args) }
	catch (error) { writeLine(stderr, error.message); writeLine(stderr, CLI_HELP); return 2 }
	if (parsed.help) { writeLine(stdout, CLI_HELP); return 0 }
	if (data.usageError) {
		writeLine(stderr, data.usageError)
		return 2
	}
	const controller = new AbortController()
	/** @returns {void} 把调用方中断转发到内部控制器。 */
	const abort = () => controller.abort()
	signal?.addEventListener('abort', abort)
	if (signal?.aborted) controller.abort()
	onCleanup(() => signal?.removeEventListener('abort', abort))
	if (parsed.promptFile) try {
		parsed.prompt = parsed.promptFile === '-' ? await readStdin(stdin, controller.signal) : await readFile(resolve(cwd, parsed.promptFile), 'utf8')
	}
	catch (error) { if (controller.signal.aborted) return 130; writeLine(stderr, error.message); return 2 }
	const print = Boolean(parsed.print || parsed.outputFormat || !(isTTY ?? Boolean(stdin.isTTY && stdout.isTTY)))
	const outputFormat = resolveCodeOutputFormat(parsed.outputFormat, stdout.isTTY ?? isTTY)
	if (print && !parsed.attach && !parsed.prompt) { writeLine(stderr, 'a prompt or --attach is required in print mode'); return 2 }
	// 下游管道提前关闭时不该让进程因未捕获的流错误崩溃：记下状态并按退出码收尾。
	let pipeClosed = false
	let stdoutError
	/**
	 * 记录 stdout 流错误，让 CLI 用退出码收尾而不是从事件回调里抛出。
	 * @param {NodeJS.ErrnoException} error - 流错误。
	 * @returns {void} 无返回值。
	 */
	const onStdoutError = error => { stdoutError = error; pipeClosed = true }
	stdout.on('error', onStdoutError)
	onCleanup(() => stdout.off('error', onStdoutError))
	const transport = createTransport({ ...data, ipcPort })
	let sigints = 0
	/** @returns {void} 第二次中断直接停止观察。 */
	const onPrintSigint = () => { if (++sigints > 1) transport.close() }
	if (print) { process.on('SIGINT', onPrintSigint); onCleanup(() => process.off('SIGINT', onPrintSigint)) }
	const client = createCodeClient({
		transport, workspaceId: data.workspaceId, sessionId: parsed.session,
		char: parsed.char, model: parsed.model, profile: parsed.profile,
		username: data.username, locale: geti18n('lang'), t: geti18n,
	})
	try {
		await client.selectWorkspace(data.workspaceId)
		await client.openSession(parsed.session)
		writeLine(stderr, `sessionId=${client.state.sessionId} workspaceId=${client.state.workspaceId}`)
		if (!print) {
			const { runTui } = await import('./tui.mjs')
			return await runTui({ client, argv: parsed, stdin, stdout, signal: controller.signal })
		}
		const collector = new PrintCollector({ outputFormat })
		let pending = Promise.resolve()
		let outputError
		try {
			/**
			 * 依次收集本轮新增条目，保持到达顺序。
			 * @param {object} event - 客户端事件。
			 * @returns {void} 无返回值。
			 */
			const onEvent = event => {
				if (event.type !== 'entry') return
				pending = pending.then(() => collector.add(event.entry, stdout)).catch(error => { outputError = error })
			}
			const result = parsed.attach ? await client.attach({ signal: controller.signal, onEvent, collectEntries: false })
				: await client.run({ input: parsed.prompt, signal: controller.signal, onEvent, collectEntries: false })
			for (const entry of result.entries) pending = pending.then(() => collector.add(entry))
			await pending
			if (!pipeClosed) await collector.write(stdout)
			writeLine(stderr, `runId=${result.runId}`)
			if (result.error) writeLine(stderr, result.error)
			if (pipeClosed || outputError) { if (stdoutError?.code !== 'EPIPE') writeLine(stderr, (outputError || stdoutError)?.message || 'stdout failed'); return 1 }
			return result.status === 'done' ? 0 : result.status === 'aborted' ? 130 : 1
		}
		catch (error) {
			await pending
			if (!pipeClosed) await collector.write(stdout).catch(() => { })
			throw error
		}
		finally { await collector.cleanup() }
	}
	catch (error) {
		if (!pipeClosed) writeLine(stderr, error.message || error)
		return controller.signal.aborted ? 130 : 1
	}
	finally { client.dispose() }
}
