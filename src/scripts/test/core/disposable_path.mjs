/**
 * 测试数据目录护栏：仅允许删除/覆写 OS 临时目录或仓库 data/test 下的路径。
 * 2026-07-13 事故：某测试把 dataDir 指到仓库真实 data/，resetData 整树 rmSync。
 */
import { tmpdir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

import { testDataRoot } from './paths.mjs'
import { REPO_ROOT } from './repo_root.mjs'

/**
 * @param {string} candidate 待校验路径
 * @param {string} root 允许的根目录
 * @returns {boolean} candidate 是否为 root 或其子路径
 */
function isUnderRoot(candidate, root) {
	const resolvedRoot = resolve(root)
	const resolvedCandidate = resolve(candidate)
	if (resolvedCandidate === resolvedRoot) return true
	const rel = relative(resolvedRoot, resolvedCandidate)
	return rel !== '' && !rel.startsWith(`..${sep}`) && !rel.startsWith('..') && !rel.includes(`..${sep}`)
}

/**
 * 断言 dataPath 可被测试框架安全删除/覆写。
 * @param {string} dataPath 数据目录
 * @returns {void}
 * @throws {Error} 路径不在 tmpdir 或 data/test 下
 */
export function assertDisposableDataPath(dataPath) {
	const resolved = resolve(dataPath)
	if (isUnderRoot(resolved, tmpdir()) || isUnderRoot(resolved, testDataRoot(REPO_ROOT)))
		return
	throw new Error(
		`refusing destructive test I/O outside disposable roots: ${resolved}\n`
		+ `allowed: tmpdir (${resolve(tmpdir())}) or ${testDataRoot(REPO_ROOT)}`,
	)
}
