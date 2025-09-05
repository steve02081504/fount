import { __dirname } from '../server/base.mjs'

import { exec } from './exec.mjs'
async function basegit(targetPath, ...args) {
	return (await exec('git -C "' + targetPath + '" ' + args.join(' '))).stdout.trim()
}
/**
 * Executes a git command within the main application directory.
 * @param {...string} args - Git command arguments.
 * @returns {Promise<string>} - Promise resolving to the trimmed stdout of the git command.
 */
export async function git(...args) {
	return basegit(__dirname, ...args)
}
/**
 * Creates a git command function bound to a specific directory.
 * @param {string} targetPath - The directory to bind the git commands to.
 * @returns {(...args: string[]): Promise<string>} - A function that executes git commands in the specified directory.
 */
git.withPath = (targetPath) => (...args) => basegit(targetPath, ...args)
export {
	git as run_git
}
