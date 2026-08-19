/**
 * AGENTS.md 及被其（间接）引用的 `.md` 须保持英文（禁止 CJK）。
 * 人类面向的 `docs/design/`、`docs/review/`、`docs/issues/`、`docs/readme/` 可为中文；仍会遍历以解析链接。
 * 闭包内非 `AGENTS.md` 的 `.md` 必须位于名为 `docs` 的目录下（路径含 `/docs/` 段）。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** 汉字 / 平假名 / 片假名 / 谚文 — 与 `scripts/test/watch` 相同的 `\p{Script=…}` 风格 */
export const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u

/**
 * 本地 `.md` 链接目标（可选尖括号、片段与标题）：
 * `](path.md)`、`](<path.md#frag>)`、`](path.md "title")`。
 */
const MD_LINK_RE = /]\(\s*(?:<([^\n#>]+?\.md)(?:#[^\s>]*)?>|([^\s#)]+?\.md)(?:#[^\s)]*)?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi

/** 人类面向、允许中文的 docs 子目录前缀 */
const HUMAN_FACING_DOCS_PREFIXES = ['docs/design/', 'docs/review/', 'docs/issues/', 'docs/readme/']

/**
 * 从 Markdown 文本收集本地 `.md` 链接目标（去掉片段）。
 * @param {string} text Markdown 源码
 * @returns {string[]} 无片段的链接目标
 */
export function localMdLinkTargets(text) {
	/** @type {string[]} */
	const targets = []
	MD_LINK_RE.lastIndex = 0
	let match
	while (match = MD_LINK_RE.exec(text)) {
		const target = match[1] || match[2]
		if (!target || /^[a-z][\d+.a-z-]*:/i.test(target) || target.startsWith('//')) continue
		targets.push(target)
	}
	return targets
}

/**
 * 人类可读的设计 / 评审 / issue 跟踪文档 — 允许中文。
 * @param {string} relativePath 仓库相对 posix 路径
 * @returns {boolean} 是否为人类面向文档
 */
export function isHumanFacingDocsPath(relativePath) {
	return HUMAN_FACING_DOCS_PREFIXES.some(prefix => relativePath.startsWith(prefix))
}

/**
 * 文件名是否为 `AGENTS.md`（大小写不敏感）。
 * @param {string} relativePath 仓库相对 posix 路径
 * @returns {boolean} 是否为 AGENTS.md
 */
export function isAgentsMdBasename(relativePath) {
	const slash = relativePath.lastIndexOf('/')
	const base = slash === -1 ? relativePath : relativePath.slice(slash + 1)
	return base.toLowerCase() === 'agents.md'
}

/**
 * 非 AGENTS.md 的 agent 闭包文档须在名为 `docs` 的目录内。
 * @param {string} relativePath 仓库相对 posix 路径
 * @returns {boolean} 路径是否含 `docs` 段（或本身是 AGENTS.md）
 */
export function isAgentsAuxDocPlacementOk(relativePath) {
	if (isAgentsMdBasename(relativePath)) return true
	return relativePath.split('/').includes('docs')
}

/**
 * 将 Markdown 相对链接解析为仓库相对 posix 路径。
 * @param {string} fromRelativePath 链接所在文件的仓库相对路径
 * @param {string} target 链接目标（可为相对路径）
 * @returns {string|null} 仓库相对 posix 路径；外部 URL 为 null
 */
export function resolveMdLink(fromRelativePath, target) {
	if (/^[a-z][\d+.a-z-]*:/i.test(target) || target.startsWith('//')) return null
	const normalized = fromRelativePath.replace(/\\/g, '/')
	const slash = normalized.lastIndexOf('/')
	const fromDirectory = slash === -1 ? '' : normalized.slice(0, slash)
	const segments = (fromDirectory ? `${fromDirectory}/${target}` : target).replace(/\\/g, '/').split('/')
	const resolved = []
	for (const segment of segments) {
		if (segment === '.' || segment === '') continue
		if (segment === '..') resolved.pop()
		else resolved.push(segment)
	}
	return resolved.join('/')
}

/**
 * 递归收集目录树中的 AGENTS.md 路径。
 * @param {string} repoRoot 仓库根绝对路径
 * @param {string} directoryPath 当前目录绝对路径
 * @param {string[]} paths 收集器
 */
async function collectAgentsMd(repoRoot, directoryPath, paths) {
	for (const directoryEntry of await readdir(directoryPath, { withFileTypes: true })) {
		const absolutePath = join(directoryPath, directoryEntry.name)
		if (directoryEntry.isDirectory()) {
			if (directoryEntry.name === 'node_modules' || directoryEntry.name === '.git' || directoryEntry.name === 'data') continue
			await collectAgentsMd(repoRoot, absolutePath, paths)
			continue
		}
		if (directoryEntry.name.toLowerCase() === 'agents.md')
			paths.push(relative(repoRoot, absolutePath).replaceAll('\\', '/'))
	}
}

/**
 * 遍历 repoRoot 下所有 AGENTS.md 及其链接的仓库内 `.md`（传递闭包）。
 * `docs/design/`、`docs/review/`、`docs/issues/`、`docs/readme/` 之外禁止 CJK。
 * 闭包内非 `AGENTS.md` 须位于 `docs/` 目录下。
 * @param {string} repoRoot 仓库根绝对路径
 * @returns {Promise<{ files: string[], issues: { path: string, lines: number[], missing?: boolean, placement?: boolean, from?: string }[] }>} 已扫描文件与问题
 */
export async function scanAgentsMdEnglish(repoRoot) {
	/** @type {string[]} */
	const roots = []
	await collectAgentsMd(repoRoot, repoRoot, roots)
	const queue = [...roots]
	const checkedTargets = new Set(queue)
	const files = new Set(queue)
	/** @type {{ path: string, lines: number[], missing?: boolean, placement?: boolean, from?: string }[]} */
	const issues = []

	while (queue.length) {
		const relativePath = queue.shift()
		const absolutePath = join(repoRoot, relativePath)
		let text
		try {
			text = await readFile(absolutePath, 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') {
				issues.push({ path: relativePath, lines: [0], missing: true })
				continue
			}
			throw error
		}
		if (!isAgentsAuxDocPlacementOk(relativePath))
			issues.push({ path: relativePath, lines: [0], placement: true })
		if (!isHumanFacingDocsPath(relativePath)) {
			const lines = text.split(/\r?\n/)
			const hitLines = []
			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++)
				if (CJK_RE.test(lines[lineIndex])) hitLines.push(lineIndex + 1)

			if (hitLines.length)
				issues.push({ path: relativePath, lines: hitLines })
		}

		for (const target of localMdLinkTargets(text)) {
			const resolved = resolveMdLink(relativePath, target)
			if (!resolved || checkedTargets.has(resolved)) continue
			checkedTargets.add(resolved)
			try {
				const fileStats = await stat(join(repoRoot, resolved))
				if (fileStats.isFile()) {
					files.add(resolved)
					queue.push(resolved)
				}
			}
			catch (error) {
				if (error?.code === 'ENOENT')
					issues.push({ path: resolved, lines: [0], missing: true, from: relativePath })
				else
					throw error
			}
		}
	}

	return { files: [...files].sort(), issues }
}
