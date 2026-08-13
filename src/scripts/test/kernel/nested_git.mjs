/**
 * data/users 下测试 manifest 的嵌套 git 根：独立 HEAD / diff，不借用 fount 仓库。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { digestFileHashes, getHeadCommitHash, getUncommittedFiles, hashUncommittedFiles } from '../core/changed.mjs'
import { nestedGitStatePath } from '../core/paths.mjs'

/**
 * 从 manifest 所在 `test/` 目录向上找嵌套 `.git`，止于 `data/users`，且不得是 fount 仓库根。
 * @param {string} manifestPath 绝对或相对仓库根的 manifest 路径
 * @param {string} repoRoot fount 仓库根
 * @returns {Promise<string | null>} 相对仓库根的 gitRoot；没有则 null
 */
export async function findNestedGitRoot(manifestPath, repoRoot) {
	const repoAbs = resolve(repoRoot)
	const usersAbs = resolve(repoRoot, 'data/users')
	let dir = dirname(resolve(repoRoot, manifestPath))
	while (dir === usersAbs || dir.startsWith(usersAbs + '\\') || dir.startsWith(usersAbs + '/')) {
		if (resolve(dir) === repoAbs) return null
		try {
			await stat(join(dir, '.git'))
			return relative(repoAbs, dir).replace(/\\/g, '/')
		}
		catch { /* 无 .git */ }
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
	return null
}

/**
 * 嵌套 git 当前快照。
 * @typedef {object} NestedGitSnapshot
 * @property {string} commitHash HEAD
 * @property {string | null} uncommittedHash 未提交 digest
 * @property {string[]} uncommittedFiles 未提交路径（已加 gitRoot 前缀）
 * @property {Map<string, string>} uncommittedHashes 仓库相对路径 → digest
 */

/**
 * 采集一个 gitRoot 的当前快照（路径转为仓库相对）。
 * @param {string} repoRoot fount 仓库根
 * @param {string} gitRoot 相对仓库根
 * @returns {Promise<NestedGitSnapshot>} 快照
 */
export async function snapshotNestedGit(repoRoot, gitRoot) {
	const abs = resolve(repoRoot, gitRoot)
	const commitHash = await getHeadCommitHash(abs)
	const rawFiles = await getUncommittedFiles(abs)
	const prefixed = rawFiles.map(file => `${gitRoot}/${file}`.replace(/\\/g, '/'))
	const nestedHashes = await hashUncommittedFiles(abs, rawFiles)
	/** @type {Map<string, string>} */
	const uncommittedHashes = new Map()
	for (const [rel, digest] of nestedHashes)
		uncommittedHashes.set(`${gitRoot}/${rel}`.replace(/\\/g, '/'), digest)
	const uncommittedHash = digestFileHashes(nestedHashes, rawFiles)
	return { commitHash, uncommittedHash, uncommittedFiles: prefixed, uncommittedHashes }
}

/**
 * 读取已记录的嵌套 git 现状。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<Record<string, { commitHash: string, uncommittedHash: string | null }>>} gitRoot → 指纹
 */
export async function readNestedGitState(repoRoot) {
	try {
		return JSON.parse(await readFile(nestedGitStatePath(repoRoot), 'utf8'))
	}
	catch {
		return {}
	}
}

/**
 * 写入嵌套 git 现状。
 * @param {string} repoRoot 仓库根
 * @param {Record<string, { commitHash: string, uncommittedHash: string | null }>} state 现状
 * @returns {Promise<void>}
 */
export async function writeNestedGitState(repoRoot, state) {
	const path = nestedGitStatePath(repoRoot)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, JSON.stringify(state, null, '\t') + '\n')
}

/**
 * 给 data/users 下的 suite 挂 gitRoot（无嵌套 git 则为 null）。
 * @param {import('../core/manifest.mjs').SuiteDef[]} suites suite 列表
 * @param {string} repoRoot 仓库根
 * @returns {Promise<void>}
 */
export async function attachGitRoots(suites, repoRoot) {
	/** @type {Map<string, string | null>} */
	const cache = new Map()
	for (const suite of suites) {
		const rel = suite.manifestPath.replace(/\\/g, '/')
		if (!rel.startsWith('data/users/')) continue
		if (!cache.has(suite.manifestPath))
			cache.set(suite.manifestPath, await findNestedGitRoot(suite.manifestPath, repoRoot))
		suite.gitRoot = cache.get(suite.manifestPath)
	}
}
