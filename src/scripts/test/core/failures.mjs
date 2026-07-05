/**
 * 按 manifest 持久化失败测试列表（data/test/failures/）。
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { failureFilePath, failuresDir } from './paths.mjs'

/**
 * 单个失败 suite 条目。
 * @typedef {{ suite: string, files?: string[] }} FailureItem
 */

/**
 * 持久化的失败记录结构。
 * @typedef {object} FailureRecord
 * @property {string | null} uncommittedHash 写入时工作区未提交内容 digest
 * @property {FailureItem[]} items 失败项
 */

/**
 * 读取 manifest 失败记录。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @returns {Promise<FailureRecord | null>} 失败记录；不存在时为 null
 */
export async function readFailures(repoRoot, manifestId) {
	const path = failureFilePath(repoRoot, manifestId)
	let raw
	try {
		raw = await readFile(path, 'utf8')
	}
	catch (error) {
		if (error?.code === 'ENOENT') return null
		throw error
	}
	if (!raw.trim()) return null
	const data = JSON.parse(raw)
	if (!Array.isArray(data.items))
		throw new Error(`invalid failure record for ${manifestId}: missing items array`)
	return { uncommittedHash: data.uncommittedHash ?? null, items: data.items }
}

/**
 * 写入或清除 manifest 失败记录。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @param {FailureItem[]} items 失败项
 * @param {string | null} [uncommittedHash] 写入时未提交内容 digest
 * @returns {Promise<void>}
 */
export async function writeFailures(repoRoot, manifestId, items, uncommittedHash = null) {
	const path = failureFilePath(repoRoot, manifestId)
	if (!items.length) return rm(path, { force: true })
	await mkdir(join(path, '..'), { recursive: true })
	await writeFile(path, `${JSON.stringify({ uncommittedHash, items }, null, '\t')}\n`, 'utf8')
}

/**
 * 清除指定或全部失败记录文件。
 * @param {string} repoRoot 仓库根
 * @param {string[]} [manifestIds] manifest id；省略则清除 failures 目录
 * @returns {Promise<void>}
 */
export async function clearFailures(repoRoot, manifestIds) {
	if (!manifestIds?.length) return rm(failuresDir(repoRoot), { recursive: true, force: true })
	for (const manifestId of manifestIds)
		await rm(failureFilePath(repoRoot, manifestId), { force: true })
}

/**
 * 递归收集 failures 目录下的 manifest id。
 * @param {string} directory 当前目录
 * @param {string} [prefix] 已累积路径
 * @returns {Promise<string[]>} manifest id 列表
 */
async function collectFailureManifestIds(directory, prefix = '') {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	}
	catch {
		return []
	}
	const manifestIds = []
	for (const entry of entries) {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory())
			manifestIds.push(...await collectFailureManifestIds(join(directory, entry.name), relativePath))
		else if (entry.name.endsWith('.json'))
			manifestIds.push(relativePath.slice(0, -5))
	}
	return manifestIds
}

/**
 * 列出存在失败记录的 manifest id。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} manifest id 列表
 */
export async function listFailedManifests(repoRoot) {
	return (await collectFailureManifestIds(failuresDir(repoRoot))).sort()
}

/**
 * 将失败记录转为 suite -> 文件映射。
 * @param {FailureRecord} record 失败记录
 * @returns {Map<string, string[] | undefined>} suite -> 文件列表
 */
export function failuresToSuiteMap(record) {
	const map = new Map()
	for (const item of record.items)
		map.set(item.suite, item.files?.length ? item.files : undefined)
	return map
}

/**
 * 合并单个 suite 的运行结果到失败列表。
 * @param {FailureItem[]} existing 已有失败项
 * @param {string} suiteName suite 名
 * @param {boolean} passed 是否通过
 * @param {string[]} [failedFiles] 失败文件
 * @returns {FailureItem[]} 更新后的失败项
 */
export function mergeSuiteResult(existing, suiteName, passed, failedFiles) {
	const rest = existing.filter(item => item.suite !== suiteName)
	if (passed) return rest
	if (failedFiles?.length) return [...rest, { suite: suiteName, files: failedFiles }]
	return [...rest, { suite: suiteName }]
}
