/**
 * 【文件】governance/branchStore.mjs — 用户主观选定的治理 DAG 分支 tip（governance_branch.json）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { groupDir } from '../lib/paths.mjs'

/**
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {string} governance_branch.json 路径
 */
function branchPath(username, groupId) {
	return `${groupDir(username, groupId)}/governance_branch.json`
}

/**
 * 读取用户选定的权限折叠分支 tip。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<string | null>} tip id 或 null
 */
export async function loadGovernanceBranchTip(username, groupId) {
	try {
		const raw = JSON.parse(await readFile(branchPath(username, groupId), 'utf8'))
		const tip = String(raw?.tipId || '').trim().toLowerCase()
		return isHex64(tip) ? tip : null
	}
	catch {
		return null
	}
}

/**
 * 保存或清除权限分支选支。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string | null} tipId 叶 id；null 表示恢复自动选支
 * @returns {Promise<void>} 无返回值
 */
export async function saveGovernanceBranchTip(username, groupId, tipId) {
	const p = branchPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	if (!tipId) {
		try {
			const { unlink } = await import('node:fs/promises')
			await unlink(p)
		}
		catch { /* absent */ }
		return
	}
	await writeFile(p, JSON.stringify({ tipId, updatedAt: Date.now() }, null, '\t'), 'utf8')
}
