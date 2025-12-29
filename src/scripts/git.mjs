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
export {
	git as run_git
}
