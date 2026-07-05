/**
 * 解析本次测试应考虑的 git 变更文件列表。
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { exec } from 'npm:@steve02081504/exec'

import { console } from '../../i18n/bare.mjs'

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
 * 对工作区未提交文件内容计算 digest；无未提交文件时返回 null。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string | null>} digest
 */
export async function computeUncommittedHash(repoRoot) {
	const files = await getUncommittedFiles(repoRoot)
	if (!files.length) return null

	const parts = []
	for (const relativePath of [...files].sort()) {
		const absolutePath = join(repoRoot, relativePath)
		try {
			await stat(absolutePath)
			const digest = createHash('sha256').update(await readFile(absolutePath)).digest('hex')
			parts.push(`${relativePath}:${digest}`)
		}
		catch (error) {
			if (error?.code === 'ENOENT') parts.push(`${relativePath}:deleted`)
			else throw error
		}
	}
	return createHash('sha256').update(parts.join('\n')).digest('hex')
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
	const output = await exec(`git diff --name-only ${base} ${head}`, { cwd: repoRoot })
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

	const mergeBase = await exec('git merge-base HEAD origin/HEAD', { cwd: repoRoot })
	if (mergeBase.code === 0 && mergeBase.stdout.trim()) {
		const files = await diffRefs(repoRoot, mergeBase.stdout.trim())
		if (files.length) return { mode: 'diff', files }
	}

	if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
		console.logI18n('fountConsole.test.ciNoDiffFallback')
		return { mode: 'all', files: [] }
	}

	return { mode: 'none', files: [] }
}
