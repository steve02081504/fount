/**
 * AGENTS.md and agent-facing linked `.md` must stay English — no CJK.
 * Human-facing `docs/design/` and `docs/review/` may be Chinese; still walk them for link resolution.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** Han / CJK Unified + Ext-A + Compatibility Ideographs */
export const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

const MD_LINK_RE = /\]\(([^)#]+\.md)(?:#[^)]*)?\)/gi

/**
 * Human-readable design/review baselines — Chinese allowed.
 * @param {string} rel repo-relative posix path
 * @returns {boolean}
 */
export function isHumanFacingDocsPath(rel) {
	return rel.startsWith('docs/design/') || rel.startsWith('docs/review/')
}

/**
 * @param {string} fromRel repo-relative path of the linking file
 * @param {string} target link target (may be relative)
 * @returns {string|null} repo-relative posix path, or null for external URLs
 */
export function resolveMdLink(fromRel, target) {
	if (/^https?:\/\//i.test(target)) return null
	const norm = fromRel.replace(/\\/g, '/')
	const slash = norm.lastIndexOf('/')
	const fromDir = slash === -1 ? '' : norm.slice(0, slash)
	const joined = fromDir ? `${fromDir}/${target}` : target
	const parts = joined.replace(/\\/g, '/').split('/')
	const out = []
	for (const part of parts) {
		if (part === '.' || part === '') continue
		if (part === '..') out.pop()
		else out.push(part)
	}
	return out.join('/')
}

/**
 * @param {string} repoRoot absolute repo root
 * @param {string} dirAbs absolute directory
 * @param {string[]} out collector
 */
async function collectAgentsMd(repoRoot, dirAbs, out) {
	for (const ent of await readdir(dirAbs, { withFileTypes: true })) {
		const abs = join(dirAbs, ent.name)
		if (ent.isDirectory()) {
			if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'data') continue
			await collectAgentsMd(repoRoot, abs, out)
			continue
		}
		if (ent.name.toLowerCase() === 'agents.md')
			out.push(relative(repoRoot, abs).replaceAll('\\', '/'))
	}
}

/**
 * Walk every AGENTS.md under repoRoot and every repo .md linked from them (transitive).
 * CJK is forbidden outside `docs/design/` and `docs/review/`.
 * @param {string} repoRoot absolute repo root
 * @returns {Promise<{ files: string[], issues: { path: string, lines: number[], missing?: boolean, from?: string }[] }>}
 */
export async function scanAgentsMdEnglish(repoRoot) {
	/** @type {string[]} */
	const roots = []
	await collectAgentsMd(repoRoot, repoRoot, roots)
	const queue = [...roots]
	const seen = new Set(queue)
	/** @type {{ path: string, lines: number[], missing?: boolean, from?: string }[]} */
	const issues = []

	while (queue.length) {
		const rel = queue.shift()
		const abs = join(repoRoot, rel)
		let text
		try {
			text = await readFile(abs, 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') {
				issues.push({ path: rel, lines: [0], missing: true })
				continue
			}
			throw error
		}
		if (!isHumanFacingDocsPath(rel)) {
			const lines = text.split(/\r?\n/)
			const hitLines = []
			for (let i = 0; i < lines.length; i++) {
				if (CJK_RE.test(lines[i])) hitLines.push(i + 1)
			}
			if (hitLines.length)
				issues.push({ path: rel, lines: hitLines })
		}

		MD_LINK_RE.lastIndex = 0
		let match
		while ((match = MD_LINK_RE.exec(text))) {
			const resolved = resolveMdLink(rel, match[1])
			if (!resolved || seen.has(resolved)) continue
			seen.add(resolved)
			try {
				const st = await stat(join(repoRoot, resolved))
				if (st.isFile()) queue.push(resolved)
			}
			catch {
				issues.push({ path: resolved, lines: [0], missing: true, from: rel })
			}
		}
	}

	return { files: [...seen].sort(), issues }
}
