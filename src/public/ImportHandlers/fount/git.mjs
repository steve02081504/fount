import { mkdir, rm } from 'node:fs/promises'

import { exec } from '../../../scripts/exec.mjs'

export async function cloneRepo(repoUrl, targetDir) {
	await mkdir(targetDir, { recursive: true })
	try {
		await exec(`git clone --depth 1 --single-branch ${repoUrl} .`, { cwd: targetDir })
	} catch (err) {
		await rm(targetDir, { recursive: true, force: true })
		throw err
	}
}
