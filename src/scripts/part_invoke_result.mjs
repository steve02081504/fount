import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** 生产默认 IPC 监听端口；`src/server/ipc_server` 复用同一常量。 */
export const DEFAULT_IPC_PORT = 16698

/**
 * 在发起 IPC 调用的进程中执行 ArgumentsHandler 的返回结果。
 * @param {{result?: object, outputs?: unknown, partRoot?: string}} response - IPC 返回结果。
 * @param {{stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream, cwd?: string, ipcPort?: number, logOutputs?: (value: unknown) => void}} [options] - 本进程资源。
 * @returns {Promise<number>} 调用模块给出的退出码。
 */
export async function dispatchArgumentsResult(response, options = {}) {
	const { result, outputs, partRoot } = response
	const {
		stdin = process.stdin,
		stdout = process.stdout,
		stderr = process.stderr,
		cwd = process.cwd(),
		ipcPort = DEFAULT_IPC_PORT,
		logOutputs = value => console.log(value),
	} = options
	if (result?.type === 'output') {
		const content = result.content.endsWith('\n') ? result.content : `${result.content}\n`
		await new Promise((resolve, reject) => {
			stdout.write(content, error => error ? reject(error) : resolve())
		})
		return 0
	}
	if (result?.type !== 'run-js') {
		logOutputs(outputs)
		return 0
	}

	const controller = new AbortController()
	const cleanup = []
	/** @returns {void} 取消模块运行；模块未响应时由模块自身的第二次中断处理。 */
	const interrupt = () => controller.abort()
	process.on('SIGINT', interrupt)
	process.on('SIGTERM', interrupt)
	try {
		const { Run } = await import(pathToFileURL(path.resolve(partRoot, result.module)).href)
		if (controller.signal.aborted) return 130
		const exitCode = await Run({
			args: result.args,
			data: result.data,
			stdin,
			stdout,
			stderr,
			cwd,
			isTTY: Boolean(stdin.isTTY && stdout.isTTY),
			columns: stdout.columns,
			rows: stdout.rows,
			ipcPort,
			signal: controller.signal,
			/** @param {() => void | Promise<void>} callback - 模块登记的清理回调。 */
			onCleanup: callback => { cleanup.push(callback) },
		})
		return controller.signal.aborted ? 130 : exitCode
	} finally {
		process.off('SIGINT', interrupt)
		process.off('SIGTERM', interrupt)
		for (const callback of cleanup.reverse()) try { await callback() } catch (error) { stderr.write(`${error}\n`) }
	}
}
