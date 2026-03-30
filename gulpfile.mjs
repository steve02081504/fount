import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * 在子进程中启动 fount（run.bat / run.sh）。
 * @param {(err?: Error) => void} done - Gulp 任务完成回调，出错时传入 Error。
 * @returns {void}
 */
function runFount(done) {
	const isWindows = process.platform === 'win32'
	const script = isWindows ? 'run.bat' : 'run.sh'

	// Delegate to the existing launcher scripts in the repo root.
	const cmd = isWindows ? 'cmd.exe' : 'sh'
	const cmdArgs = isWindows ? ['/c', script] : [script]

	// Support FOUNT_ARGS env var for passing arguments, e.g.: FOUNT_ARGS=nop gulp
	const extraArgs = process.env.FOUNT_ARGS ? process.env.FOUNT_ARGS.split(' ') : []

	const child = spawn(cmd, [...cmdArgs, ...extraArgs], {
		cwd: process.cwd(),
		stdio: 'inherit',
	})

	child.on('error', (err) => done(err))
	child.on('close', (code) => {
		// gulp convention: pass error first, then result code.
		done(code ? new Error(`fount exited with code ${code}`) : null)
	})
}

/**
 * 启动 fount。
 */
export { runFount as run }
/**
 * 默认导出。
 */
export default runFount
