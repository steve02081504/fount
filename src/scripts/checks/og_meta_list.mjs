/**
 * 从完整 HTML 提取 `og:title` / `og:description`。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseHTML } from 'npm:linkedom'

import { isFullHtmlDocument } from './html_meta.mjs'
import { listRepoFiles } from './walk.mjs'

/**
 * 从 DOM 文档提取 og:title / og:description。
 * @param {Document} document 解析后的 HTML 文档
 * @returns {{ title: string, description: string } | null} 至少一项非空则返回对象，否则 null
 */
export function extractOgMeta(document) {
	const head = document.querySelector('head')
	if (!head) return null
	const title = head.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? ''
	const description = head.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ?? ''
	if (!title && !description) return null
	return { title, description }
}

/**
 * 从 HTML 文本提取 og 元数据。
 * @param {string} content HTML 文本
 * @returns {{ skipped: true } | { skipped: false, meta: { title: string, description: string } }} 非完整文档或无 og 则 skipped
 */
export function inspectOgMeta(content) {
	if (!isFullHtmlDocument(content))
		return { skipped: true }
	const { document } = parseHTML(content)
	const meta = extractOgMeta(document)
	if (!meta)
		return { skipped: true }
	return { skipped: false, meta }
}

/**
 * 路径是否等于 under，或位于 under 目录下（避免 pages 误收 pages2）。
 * @param {string} rel 仓库相对路径
 * @param {string} [under] 规范化前缀
 * @returns {boolean} 匹配前缀或等于 under 则为 true
 */
export function pathMatchesUnder(rel, under) {
	if (!under) return true
	const path = rel.replace(/\\/g, '/')
	return path === under || path.startsWith(`${under}/`)
}

/**
 * 列举仓库内带 og 元数据的 HTML。
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string }} [options] 可选路径前缀过滤
 * @returns {Promise<{ files: string[], entries: Array<{ path: string, title: string, description: string }> }>} 文件列表与 og 条目
 */
export async function listOgMeta(repoRoot, options = {}) {
	const under = options.under?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
	const files = (await listRepoFiles(repoRoot, ['.html']))
		.filter(rel => pathMatchesUnder(rel, under))

	/** @type {Array<{ path: string, title: string, description: string }>} */
	const entries = []

	for (const rel of files) {
		const content = await readFile(join(repoRoot, rel), 'utf8')
		const result = inspectOgMeta(content)
		if (result.skipped) continue
		entries.push({
			path: rel.replace(/\\/g, '/'),
			title: result.meta.title,
			description: result.meta.description,
		})
	}

	return { files, entries }
}
