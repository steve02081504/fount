/**
 * 从完整 HTML 提取 `og:title` / `og:description`。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseHTML } from 'npm:linkedom'

import { isFullHtmlDocument } from './html_meta.mjs'
import { listRepoFiles } from './walk.mjs'

/**
 * @param {Document} document
 * @returns {{ title: string, description: string } | null}
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
 * @param {string} content HTML 文本
 * @returns {{ skipped: true } | { skipped: false, meta: { title: string, description: string } }}
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
 * @returns {boolean}
 */
export function pathMatchesUnder(rel, under) {
	if (!under) return true
	const path = rel.replace(/\\/g, '/')
	return path === under || path.startsWith(`${under}/`)
}

/**
 * @param {string} repoRoot 仓库根
 * @param {{ under?: string }} [options]
 * @returns {Promise<{ files: string[], entries: Array<{ path: string, title: string, description: string }> }>}
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
