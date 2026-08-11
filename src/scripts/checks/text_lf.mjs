/**
 * 仓库 UTF-8 文本文件须使用 LF 换行（禁止 CRLF / 孤立 CR）。
 * 判定文本：整文件可 fatal UTF-8 解码且不含 NUL。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readTestTriggeredFiles } from '../test/core/protocol.mjs'

import { listRepoFiles } from './walk.mjs'

/** 本检查器自身路径：仅它们变更时回退全仓扫描。 */
export const TEXT_LF_OWN_PATHS = Object.freeze([
	'src/scripts/checks/text_lf.mjs',
	'src/scripts/checks/walk.mjs',
	'src/scripts/checks/test/text_lf.test.mjs',
])

const utf8Fatal = new TextDecoder('utf-8', { fatal: true })

/**
 * @typedef {'crlf' | 'cr' | 'mixed'} TextNonLfKind 非 LF 换行种类
 */

/**
 * @typedef {{ path: string, kind: TextNonLfKind }} TextLfIssue 命中条目
 */

/**
 * 是否为可检查的 UTF-8 文本（无 NUL、fatal 解码成功）。
 * @param {Uint8Array} bytes 文件原始字节
 * @returns {boolean} 是文本则为 true
 */
export function isUtf8Text(bytes) {
	if (bytes.includes(0)) return false
	try {
		utf8Fatal.decode(bytes)
		return true
	}
	catch {
		return false
	}
}

/**
 * 检测字节内容中的非 LF 换行。
 * @param {Uint8Array} bytes 文件原始字节
 * @returns {TextNonLfKind | null} 非 LF 则为种类，否则 null
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
 * 扫描单文件（调用方已确认是 UTF-8 文本）。
 * @param {string} relativePath 相对仓库根
 * @param {Uint8Array} bytes 文件原始字节
 * @returns {TextLfIssue | null} 命中则返回问题，否则 null
 */
export function scanFileTextLf(relativePath, bytes) {
	const kind = detectNonLfLineEndings(bytes)
	return kind ? { path: relativePath, kind } : null
}

/**
 * 解析本波次要扫描的路径。
 * 有 trigger 列表且其中含检查器自身以外的路径 → 只扫那些；
 * 否则（空 / 仅命中检查器自身）→ 全仓。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, triggeredFiles?: string[] }} [options] 选项
 * @returns {Promise<string[]>} 相对路径（正斜杠、已排序）
 */
export async function resolveTextLfScanPaths(repoRoot, options = {}) {
	const under = options.under ? options.under.replaceAll('\\', '/').replace(/\/$/u, '') : ''
	const own = new Set(TEXT_LF_OWN_PATHS)
	const triggered = options.triggeredFiles ?? await readTestTriggeredFiles()
	const scoped = triggered
		.map(path => path.replaceAll('\\', '/'))
		.filter(path => !own.has(path))
		.filter(path => !under || path === under || path.startsWith(`${under}/`))
	if (triggered.length && scoped.length)
		return [...new Set(scoped)].sort()
	return listRepoFiles(repoRoot, null, { under: options.under })
}

/**
 * 扫描仓库中 UTF-8 文本文件的换行（增量：trigger 命中；否则全量）。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string, triggeredFiles?: string[] }} [options] 选项
 * @returns {Promise<{ files: string[], issues: TextLfIssue[] }>} 扫描到的问题路径与列表
 */
export async function scanTextLf(repoRoot, options = {}) {
	/** @type {TextLfIssue[]} */
	const issues = []
	for (const relativePath of await resolveTextLfScanPaths(repoRoot, options)) {
		let bytes
		try {
			bytes = new Uint8Array(await readFile(join(repoRoot, relativePath)))
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		if (!isUtf8Text(bytes)) continue
		const issue = scanFileTextLf(relativePath, bytes)
		if (issue) issues.push(issue)
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
