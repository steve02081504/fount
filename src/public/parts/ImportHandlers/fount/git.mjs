import { mkdir, rm } from 'node:fs/promises'

import { exec } from 'npm:@steve02081504/exec'

/**
 * 克隆 Git 仓库。
 * @param {string} repoUrl - 仓库 URL。
 * @param {string} targetDir - 目标目录。
 * @returns {Promise<void>}
 */
export async function cloneRepo(repoUrl, targetDir) {
	await mkdir(targetDir, { recursive: true })
	try {
		await exec(`git clone --depth 1 --single-branch ${repoUrl} .`, { cwd: targetDir })
	}
	catch (err) {
		await rm(targetDir, { recursive: true, force: true })
		throw err
	}
}
