/**
 * 仓库文件遍历（尊重 gitignore；默认走 git ls-files）。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { execFile } from 'npm:@steve02081504/exec'
import createIgnore from 'npm:ignore'

import I18N_REWRITE_EXCLUDE_PREFIXES from './i18n_rewrite_exclude_prefixes.json' with { type: 'json' }

/** 两遍 i18n 键改写共享的源码后缀（含 path/fount.sh — reshape 须改写相对 get_i18n 键）。 */
export const I18N_REWRITE_SUFFIXES = [
	'.mjs', '.js', '.ts', '.html', '.ps1', '.sh', '.py',
]

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
 * 路径是否匹配后缀列表；空列表表示不过滤。
 * @param {string} relativePath 相对路径
 * @param {string[] | null | undefined} suffixes 后缀；空/缺省=全部
 * @returns {boolean} 是否保留
 */
function matchesSuffixes(relativePath, suffixes) {
	if (!suffixes?.length) return true
	return suffixes.some(suffix => relativePath.endsWith(suffix))
}

/**
 * 经 git 列出工作区文件（已跟踪 + 未忽略未跟踪；尊重嵌套 gitignore）。
 * @param {string} repoRoot 仓库根
 * @param {string} [under=''] 相对子目录
 * @returns {Promise<string[]>} 相对路径（正斜杠）
 */
async function listViaGit(repoRoot, under = '') {
	const scope = under ? ['--', under] : []
	const [tracked, untracked] = await Promise.all([
		execFile('git', ['ls-files', '-z', ...scope], { cwd: repoRoot }),
		execFile('git', ['ls-files', '-z', '--others', '--exclude-standard', ...scope], { cwd: repoRoot }),
	])
	if (tracked.code !== 0)
		throw new Error(tracked.stderr || `git ls-files failed (${tracked.code})`)
	if (untracked.code !== 0)
		throw new Error(untracked.stderr || `git ls-files --others failed (${untracked.code})`)
	/** @type {string[]} */
	const files = []
	for (const chunk of [tracked.stdout, untracked.stdout]) {
		if (!chunk) continue
		for (const path of String(chunk).split('\0')) {
			const normalized = path.trim().replaceAll('\\', '/')
			if (normalized) files.push(normalized)
		}
	}
	return [...new Set(files)]
}

/**
 * 文件系统递归收集（仅根 .gitignore；供自定义 ignore 使用）。
 * @param {string} repoRoot 仓库根
 * @param {string[] | null | undefined} suffixes 后缀；空=全部
 * @param {object} options 选项
 * @param {string} [options.under=''] 子目录
 * @param {import('npm:ignore').Ignore} options.ignore ignore 实例
 * @returns {Promise<string[]>} 相对路径
 */
async function listViaWalk(repoRoot, suffixes, options) {
	const filter = options.ignore
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
			if (matchesSuffixes(rel, suffixes))
				out.push(rel)
		}
	}
	await walk(start)
	return out
}

/**
 * 递归收集匹配后缀的文件（相对仓库根、正斜杠）。
 * 默认 `git ls-files`（含未忽略未跟踪）；传入 `ignore` 时改走文件系统遍历。
 * @param {string} repoRoot 仓库根
 * @param {string[] | null | undefined} [suffixes] 后缀（如 `.html`）；空/缺省=全部
 * @param {object} [options] 选项
 * @param {string} [options.under=''] 相对仓库根的子目录（空=整仓）
 * @param {import('npm:ignore').Ignore} [options.ignore] 自定义 ignore → 文件系统遍历
 * @returns {Promise<string[]>} 相对路径列表（已排序）
 */
export async function listRepoFiles(repoRoot, suffixes, options = {}) {
	const under = options.under ? options.under.replaceAll('\\', '/').replace(/\/$/u, '') : ''
	const files = options.ignore
		? await listViaWalk(repoRoot, suffixes, { under, ignore: options.ignore })
		: await listViaGit(repoRoot, under)
	return files.filter(path => matchesSuffixes(path, suffixes)).sort()
}
