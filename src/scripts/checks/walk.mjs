/**
 * 仓库文件遍历（尊重 .gitignore）。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import createIgnore from 'npm:ignore'

import I18N_REWRITE_EXCLUDE_PREFIXES from './i18n_rewrite_exclude_prefixes.json' with { type: 'json' }

/** 两遍 i18n 键改写共享的源码后缀。 */
export const I18N_REWRITE_SUFFIXES = Object.freeze([
	'.mjs', '.js', '.ts', '.html', '.ps1', '.py',
])

/**
 * i18n 改写应跳过的相对路径。
 * @param {string} relativePath 相对仓库根、正斜杠
 * @returns {boolean} 应跳过则为 true
 */
export function isI18nRewriteExcluded(relativePath) {
	return I18N_REWRITE_EXCLUDE_PREFIXES.some(prefix =>
		relativePath.startsWith(prefix) || `/${relativePath}`.includes(`/${prefix}`))
}

/**
 * 加载仓库根的 .gitignore 为 ignore 过滤器。
 * @param {string} repoRoot 仓库根绝对路径
 * @returns {Promise<import('npm:ignore').Ignore>} ignore 实例
 */
export async function loadGitignore(repoRoot) {
	const filter = createIgnore()
	try {
		filter.add(await readFile(join(repoRoot, '.gitignore'), 'utf8'))
	}
	catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
	filter.add('.git')
	return filter
}

/**
 * 递归收集匹配后缀的文件（相对仓库根、正斜杠）。
 * @param {string} repoRoot 仓库根
 * @param {string[]} suffixes 后缀（如 `.html`）
 * @param {object} [options] 选项
 * @param {string} [options.under=''] 相对仓库根的子目录（空=整仓）
 * @param {import('npm:ignore').Ignore} [options.ignore] gitignore；缺省则加载
 * @returns {Promise<string[]>} 相对路径列表（已排序）
 */
export async function listRepoFiles(repoRoot, suffixes, options = {}) {
	const filter = options.ignore ?? await loadGitignore(repoRoot)
	const start = options.under ? join(repoRoot, options.under) : repoRoot
	/** @type {string[]} */
	const out = []
	/**
	 * @param {string} dir 绝对目录
	 * @returns {Promise<void>}
	 */
	async function walk(dir) {
		for (const ent of await readdir(dir, { withFileTypes: true })) {
			const abs = join(dir, ent.name)
			const rel = relative(repoRoot, abs).replaceAll('\\', '/')
			if (ent.isDirectory()) {
				if (filter.ignores(`${rel}/`)) continue
				await walk(abs)
				continue
			}
			if (filter.ignores(rel)) continue
			if (suffixes.some(suffix => rel.endsWith(suffix)))
				out.push(rel)
		}
	}
	await walk(start)
	return out.sort()
}
