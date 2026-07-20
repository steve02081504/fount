/**
 * 解析本次测试应考虑的 git 变更文件列表。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { exec, execFile } from 'npm:@steve02081504/exec'

/**
 * 收集工作区未提交变更（含未跟踪文件）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 相对路径列表（正斜杠）
 */
export async function getUncommittedFiles(repoRoot) {
	const tracked = await exec('git diff --name-only HEAD', { cwd: repoRoot })
	const untracked = await exec('git ls-files --others --exclude-standard', { cwd: repoRoot })
	const files = []
	if (tracked.code === 0 && tracked.stdout.trim())
		files.push(...tracked.stdout.trim().split('\n'))
	if (untracked.code === 0 && untracked.stdout.trim())
		files.push(...untracked.stdout.trim().split('\n'))
	return [...new Set(files.map(path => path.trim().replace(/\\/g, '/')).filter(Boolean))]
}

/**
 * 逐个读取未提交文件内容算 digest；删除的记 'deleted'。一次读取即可供全局哈希与
 * 各 suite 的 trigger 哈希共享，避免同一文件被反复读。
 * @param {string} repoRoot 仓库根
 * @param {string[]} uncommittedFiles 未提交文件（正斜杠相对路径）
 * @returns {Promise<Map<string, string>>} rel -> 内容 digest（或 'deleted'）
 */
export async function hashUncommittedFiles(repoRoot, uncommittedFiles) {
	const entries = await Promise.all(uncommittedFiles.map(async rel => {
		try {
			return [rel, createHash('sha256').update(await readFile(join(repoRoot, rel))).digest('hex')]
		}
		catch (error) {
			if (error?.code === 'ENOENT') return [rel, 'deleted']
			throw error
		}
	}))
	return new Map(entries)
}

/**
 * 把「rel -> 内容 digest」的一个子集折叠成单一指纹；子集为空返回 null。
 * @param {Map<string, string>} hashes 全量内容 digest 表
 * @param {string[]} relPaths 参与折叠的相对路径
 * @returns {string | null} 指纹
 */
export function digestFileHashes(hashes, relPaths) {
	const sorted = [...relPaths].sort()
	if (!sorted.length) return null
	const parts = sorted.map(rel => `${rel}:${hashes.get(rel) ?? 'deleted'}`)
	return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/**
 * 对工作区未提交文件内容计算 digest；无未提交文件时返回 null。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string | null>} digest
 */
export async function computeUncommittedHash(repoRoot) {
	const files = await getUncommittedFiles(repoRoot)
	return digestFileHashes(await hashUncommittedFiles(repoRoot, files), files)
}

/**
 * 返回当前 HEAD commit hash。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string>} commit hash
 */
export async function getHeadCommitHash(repoRoot) {
	const output = await exec('git rev-parse HEAD', { cwd: repoRoot })
	if (output.code !== 0 || !output.stdout.trim())
		throw new Error('git rev-parse HEAD failed')
	return output.stdout.trim()
}

/**
 * 对比两个 git ref 获取变更文件列表。
 * @param {string} repoRoot 仓库根
 * @param {string} base 基准 ref
 * @param {string} [head='HEAD'] 目标 ref
 * @returns {Promise<string[]>} 变更文件相对路径
 */
export async function diffRefs(repoRoot, base, head = 'HEAD') {
	const output = await execFile('git', ['diff', '--name-only', base, head], { cwd: repoRoot })
	if (output.code !== 0 || !output.stdout.trim()) return []
	return output.stdout.trim().split('\n').map(path => path.replace(/\\/g, '/'))
}

/**
 * 收集 suite 自记录 commit 以来可能影响的变更文件（含未提交）。
 * @param {string} repoRoot 仓库根
 * @param {string | null | undefined} recordedCommit 上次运行时的 HEAD
 * @param {string[]} uncommittedFiles 未提交文件
 * @returns {Promise<string[]>} 变更文件列表
 */
export async function collectChangesSinceRecord(repoRoot, recordedCommit, uncommittedFiles) {
	const files = new Set(uncommittedFiles)
	if (recordedCommit)
		for (const file of await diffRefs(repoRoot, recordedCommit))
			files.add(file)
	return [...files]
}
/**
 * 解析变更文件列表。
 * @param {object} options 选项
 * @param {string} options.repoRoot 仓库根目录
 * @param {boolean} [options.runAll] 强制全量
 * @param {string} [options.since] 与 HEAD 对比的 commit/ref
 * @returns {Promise<{ mode: 'all' | 'diff' | 'none', files: string[] }>} 选择模式与文件列表
 */
export async function resolveChangedFiles({ repoRoot, runAll = false, since }) {
	const {
		FOUNT_TEST_RUN_ALL,
		FOUNT_TEST_CHANGED_FILES: changedFilesEnv,
		GITHUB_EVENT_BEFORE: base,
		GITHUB_SHA: head,
	} = process.env

	if (runAll || FOUNT_TEST_RUN_ALL === '1')
		return { mode: 'all', files: [] }

	if (changedFilesEnv?.trim())
		return { mode: 'diff', files: changedFilesEnv.split('\n').map(path => path.trim().replace(/\\/g, '/')).filter(Boolean) }

	if (since)
		return { mode: 'diff', files: await diffRefs(repoRoot, since) }

	const uncommitted = await getUncommittedFiles(repoRoot)
	if (uncommitted.length)
		return { mode: 'diff', files: uncommitted }

	if (base && head && base !== '0000000000000000000000000000000000000000') {
		const files = await diffRefs(repoRoot, base, head)
		if (files.length) return { mode: 'diff', files }
	}

	const mergeBase = await execFile('git', ['merge-base', 'HEAD', 'origin/HEAD'], { cwd: repoRoot })
	if (mergeBase.code === 0 && mergeBase.stdout.trim()) {
		const files = await diffRefs(repoRoot, mergeBase.stdout.trim())
		if (files.length) return { mode: 'diff', files }
	}

	if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true')
		return { mode: 'all', files: [] }

	return { mode: 'none', files: [] }
}
