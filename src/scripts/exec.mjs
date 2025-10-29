import { exec } from 'node:child_process'
import { promisify } from 'node:util'
/**
 * `child_process.exec` 的 promisified 版本。
 * @param {string} command - 要运行的命令。
 * @param {import('child_process').ExecOptions} [options] - 传递给 `exec` 的选项。
 * @returns {Promise<{stdout: string, stderr: string}>} 一个解析为命令的 stdout 和 stderr 的 promise。
 */
const PromiseExec = promisify(exec)

export default PromiseExec
export {
	PromiseExec as exec
}
