/**
 * 【文件】src/public/parts/shells/code/src/search_index.mjs
 * 【职责】为 code shell 打开的工作区启动 tgrep 索引服务。
 * 【原理】仅本机工作区、非测试进程时执行：优先用 PATH 上的 tgrep，缺失则安装官方发布版，再后台 detached 启动 `tgrep serve`；
 *   索引目录按工作区绝对路径哈希落在系统临时目录，启动失败只告警并由 `started` 记录允许重试。
 * 【关联】endpoints.mjs 在新增/切换工作区时调用；二进制获取见 tgrep_binary.mjs。
 */
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { launchDetachedProgram } from '../../../../../scripts/launch_external.mjs'

import { ensureTgrepBinary } from './tgrep_binary.mjs'

const started = new Set()

/**
 * 工作区对应的索引目录（同一路径的大小写差异视为同一索引）。
 * @param {string} root - 工作区绝对路径。
 * @returns {string} 索引目录路径。
 */
export function tgrepIndexPath(root) {
	const key = process.platform === 'win32' ? root.toLowerCase() : root
	return path.join(os.tmpdir(), 'tgrep', createHash('sha256').update(key).digest('hex'))
}

/**
 * 启动工作区索引构建，不阻塞工作区激活。
 * @param {{machine?: string|number, path: string}} workspace - 目标工作区。
 * @returns {Promise<void>}
 */
export async function startWorkspaceSearchIndex(workspace) {
	if (process.env.FOUNT_TEST || Number(workspace.machine || 0) !== 0) return
	const root = path.resolve(workspace.path)
	if (started.has(root)) return
	started.add(root)
	try {
		await launchDetachedProgram({
			command: await resolveTgrepCommand(),
			args: ['serve', root, '--index-path', tgrepIndexPath(root), '--no-require-git'],
			windowsHide: true,
		})
	}
	catch (error) {
		started.delete(root)
		if (!(error instanceof globalThis.Deno.errors.NotFound)) console.warn('code shell search index:', error)
	}
}

/**
 * 取得可用的 tgrep 命令：PATH 上的优先，缺失时安装官方发布版。
 * @returns {Promise<string>} tgrep 命令或可执行文件路径。
 */
async function resolveTgrepCommand() {
	try { await probeTgrep('tgrep') }
	catch (error) {
		if (!(error instanceof globalThis.Deno.errors.NotFound)) throw error
		const installed = await ensureTgrepBinary()
		if (!installed) throw error
		await probeTgrep(installed)
		return installed
	}
	return 'tgrep'
}

/**
 * 校验 tgrep 命令可执行。
 * @param {string} command - 命令名或路径。
 * @returns {Promise<void>}
 */
async function probeTgrep(command) {
	const { success } = await new globalThis.Deno.Command(command, { args: ['--version'], stdout: 'null', stderr: 'null' }).output()
	if (!success) throw new Error(`${command} --version failed`)
}
