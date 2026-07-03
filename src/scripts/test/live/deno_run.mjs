/**
 * live 套件 deno run 命令行片段（与 chat/social run.mjs 共用）。
 */
import { join } from 'node:path'

import { REPO_ROOT } from '../core/repo_root.mjs'

/**
 * @param {string} scriptPath 探针脚本绝对路径
 * @returns {string[]} deno run 命令 argv
 */
export function denoLiveRun(scriptPath) {
	return ['deno', 'run', '--allow-all', '-c', join(REPO_ROOT, 'deno.json'), scriptPath]
}
