/**
 * AGENTS.md and agent-facing linked `.md` must stay English — no CJK.
 * Human-facing `docs/design/` and `docs/review/` may be Chinese; still walk them for link resolution.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** Han / Hiragana / Katakana / Hangul — same `\p{Script=…}` style as `test_watch.mjs` */
export const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u

/**
 * Local `.md` destinations with optional angle brackets, fragments, and titles:
 * `](path.md)`, `](<path.md#frag>)`, `](path.md "title")`.
 */
const MD_LINK_RE = /\]\(\s*(?:<([^>\n#]+?\.md)(?:#[^>\s]*)?>|([^)\s#]+?\.md)(?:#[^)\s]*)?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi

/**
 * Collect local `.md` link destinations from Markdown text (fragments stripped).
 * @param {string} text Markdown source
 * @returns {string[]} link targets without fragments
 */
export function localMdLinkTargets(text) {
	/** @type {string[]} */
	const targets = []
	MD_LINK_RE.lastIndex = 0
	let match
	while (match = MD_LINK_RE.exec(text)) {
		const target = match[1] || match[2]
		if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue
		targets.push(target)
	}
	return targets
}

/**
 * Human-readable design/review baselines — Chinese allowed.
 * @param {string} relativePath repo-relative posix path
 * @returns {boolean} whether the path is human-facing design/review docs
 */
export function isHumanFacingDocsPath(relativePath) {
	return relativePath.startsWith('docs/design/') || relativePath.startsWith('docs/review/')
}

/**
 * @param {string} fromRelativePath repo-relative path of the linking file
 * @param {string} target link target (may be relative)
 * @returns {string|null} repo-relative posix path, or null for external URLs
 */
export function resolveMdLink(fromRelativePath, target) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null
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
 * @param {string} repoRoot absolute repo root
 * @param {string} directoryPath absolute directory
 * @param {string[]} paths collector
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
 * Walk every AGENTS.md under repoRoot and every repo .md linked from them (transitive).
 * CJK is forbidden outside `docs/design/` and `docs/review/`.
 * @param {string} repoRoot absolute repo root
 * @returns {Promise<{ files: string[], issues: { path: string, lines: number[], missing?: boolean, from?: string }[] }>} scanned files and CJK/missing-link issues
 */
export async function scanAgentsMdEnglish(repoRoot) {
	/** @type {string[]} */
	const roots = []
	await collectAgentsMd(repoRoot, repoRoot, roots)
	const queue = [...roots]
	const checkedTargets = new Set(queue)
	const files = new Set(queue)
	/** @type {{ path: string, lines: number[], missing?: boolean, from?: string }[]} */
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
