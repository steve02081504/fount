import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { exec } from 'npm:@steve02081504/exec'

import { __dirname } from '../server/base.mjs'

/**
 * 在指定目录中执行 git 命令。
 * @param {string} targetPath - 运行 git 命令的目录。
 * @param {...string} args - Git 命令参数。
 * @returns {Promise<string>} - 解析为 git 命令的修剪后 stdout 的 Promise。
 */
async function basegit(targetPath, ...args) {
	return (await exec(`git -C "${targetPath}" ${args.join(' ')}`)).stdout.trim()
}

/**
 * 在主应用程序目录中执行 git 命令。
 * @param {...string} args - Git 命令参数。
 * @returns {Promise<string>} - 解析为 git 命令的修剪后 stdout 的 Promise。
 */
export async function git(...args) {
	return basegit(__dirname, ...args)
}
/**
 * 创建一个绑定到特定目录的 git 命令函数。
 * @param {string} targetPath - 要绑定 git 命令的目录。
 * @returns {(...args: string[]): Promise<string>} - 在指定目录中执行 git 命令的函数。
 */
git.withPath = (targetPath) => (...args) => basegit(targetPath, ...args)
/**
 * `git` 的别名。
 */
export const run_git = git

/**
 * 与 Shell 一致的本地时间戳（yyyyMMdd_HHmmss）。
 * @returns {string} - 用于备份 diff 文件名的时间戳片段。
 */
function formatLocalTimestampForBackup() {
	const d = new Date()
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
}
/**
 * 若工作区存在未提交更改，则写入单一 diff。
 * @param {string} repoPath - Git 仓库根目录路径。
 * @returns {Promise<{ diffPath: string } | null>} 有未提交改动时返回 diff 路径，否则返回 null。
 */
export async function backupGitUncommittedChanges(repoPath) {
	const git = run_git.withPath(repoPath)
	const status = await git('status --porcelain')
	if (!status) return null

	const diffPath = path.join(tmpdir(), `fount-local-changes-diff_${formatLocalTimestampForBackup()}.diff`)
	const hasHead = await git('rev-parse --verify HEAD')

	await git('add -A')
	const body = await git('diff --cached') + '\n'
	if (hasHead) await git('reset HEAD')
	else await git('reset')

	await fs.promises.writeFile(diffPath, body, 'utf8')
	return { path: diffPath }
}
