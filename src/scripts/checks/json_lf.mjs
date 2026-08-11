/**
 * 仓库 JSON 文件须使用 LF 换行（禁止 CRLF / 孤立 CR）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readTestTriggeredFiles } from '../test/core/protocol.mjs'

import { listRepoFiles } from './walk.mjs'

/** JSON 扫描后缀。 */
export const JSON_LF_SUFFIXES = ['.json']

/**
 * @typedef {'crlf' | 'cr' | 'mixed'} JsonNonLfKind 非 LF 换行种类
 */

/**
 * @typedef {{ path: string, kind: JsonNonLfKind }} JsonLfIssue 命中条目
 */

/**
 * 检测字节内容中的非 LF 换行。
 * @param {Uint8Array} bytes 文件原始字节
 * @returns {JsonNonLfKind | null} 非 LF 则为种类，否则 null
 */
export function detectNonLfLineEndings(bytes) {
	let crlf = false
	let loneCr = false
	for (let index = 0; index < bytes.length; index++) {
		if (bytes[index] !== 13) continue
		if (bytes[index + 1] === 10) crlf = true
		else loneCr = true
	}
	if (crlf && loneCr) return 'mixed'
	if (crlf) return 'crlf'
	if (loneCr) return 'cr'
	return null
}

/**
 * 扫描单文件。
 * @param {string} relativePath 相对仓库根
 * @param {Uint8Array} bytes 文件原始字节
 * @returns {JsonLfIssue | null} 命中则返回问题，否则 null
 */
export function scanFileJsonLf(relativePath, bytes) {
	const kind = detectNonLfLineEndings(bytes)
	return kind ? { path: relativePath, kind } : null
}

/**
 * 解析本波次要扫描的 JSON 路径。
 * 有 trigger 列表且其中含 `.json` → 只扫那些；
 * 否则（空 / 仅命中检查器自身）→ 全仓 `listRepoFiles`。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, triggeredFiles?: string[] }} [options] 选项
 * @returns {Promise<string[]>} 相对路径（正斜杠、已排序）
 */
export async function resolveJsonLfScanPaths(repoRoot, options = {}) {
	const under = options.under ? options.under.replaceAll('\\', '/').replace(/\/$/u, '') : ''
	const triggered = options.triggeredFiles ?? await readTestTriggeredFiles()
	const scoped = triggered
		.filter(path => JSON_LF_SUFFIXES.some(suffix => path.endsWith(suffix)))
		.filter(path => !under || path === under || path.startsWith(`${under}/`))
		.map(path => path.replaceAll('\\', '/'))
	if (triggered.length && scoped.length)
		return [...new Set(scoped)].sort()
	return listRepoFiles(repoRoot, JSON_LF_SUFFIXES, { under: options.under })
}

/**
 * 扫描仓库中 JSON 文件（增量：trigger 命中；否则全量）。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, triggeredFiles?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: JsonLfIssue[] }>} 扫描路径与问题列表
 */
export async function scanJsonLf(repoRoot, options = {}) {
	const paths = await resolveJsonLfScanPaths(repoRoot, options)
	/** @type {JsonLfIssue[]} */
	const issues = []
	for (const relativePath of paths) {
		let bytes
		try {
			bytes = new Uint8Array(await readFile(join(repoRoot, relativePath)))
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		const issue = scanFileJsonLf(relativePath, bytes)
		if (issue) issues.push(issue)
	}
	const hitFiles = [...new Set(issues.map(issue => issue.path))].sort()
	return { files: hitFiles, issues }
}
