/**
 * 读取文件时的上下文收集：沿目录向上查找 AGENTS.md 与 `.agents/docs/*.md`（yaml 头 glob 触发）。
 * 供 file-operations / code shell 等共用，配合 `target.mjs` 的执行器实现本机/远程一致。
 */

/**
 * 从 markdown 文本中解析 yaml frontmatter 的简单标量键值。
 * @param {string} text - 文件内容。
 * @returns {Record<string, string>} frontmatter 键值（无 frontmatter 时为空对象）。
 */
export function parseFrontmatter(text) {
	const match = text.match(/^---\r?\n([^]*?)\r?\n---\r?\n?/)
	if (!match) return {}
	const result = {}
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
		if (!kv) continue
		const value = kv[2].trim().replace(/^['"]|['"]$/g, '')
		result[kv[1]] = value
	}
	return result
}

/**
 * 极简 glob → RegExp（`**` 可跨零层或多层目录、`*` 单段、`?` 单字符）。
 * @param {string} glob - glob 模式（POSIX 分隔符）。
 * @returns {RegExp} 匹配用正则。
 */
export function globToRegExp(glob) {
	let re = ''
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i]
		if (glob[i] === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
			re += '(?:.*/)?'
			i += 2
		}
		else if (glob[i] === '*' && glob[i + 1] === '*') {
			re += '.*'
			i++
		}
		else if (ch === '*') re += '[^/]*'
		else if (ch === '?') re += '[^/]'
		else re += ch.replace(new RegExp('[.+^${}()|[\\]\\\\]', 'g'), '\\$&')
	}
	return new RegExp(`^${re}$`)
}

/**
 * 目录条目。
 * @typedef {{name: string, isDirectory: boolean, isFile: boolean}} dirEntry_t
 */

/**
 * 上下文收集结果。
 * @typedef {object} upwardContext_t
 * @property {{path: string, content: string}[]} agents - 各级 AGENTS.md（自近及远）。
 * @property {{path: string, content: string}[]} docs - 触发的 .agents/docs/*.md。
 */

/**
 * 读取文件时收集向上上下文。
 * @param {import('./target.mjs').targetExecutor_t} executor - 目标执行器。
 * @param {string|undefined} workspaceRoot - 工作区根（绝对或相对目标 workdir）。
 * @param {string} filePath - 被读取的文件路径。
 * @returns {Promise<upwardContext_t>} 收集结果（path 为原始给定路径）。
 */
export async function collectUpwardContext(executor, workspaceRoot, filePath) {
	const agents = []
	const docs = []
	const seen = new Set()
	/**
	 * 将路径分隔符统一为 POSIX。
	 * @param {string} p - 路径。
	 * @returns {string} POSIX 化路径。
	 */
	const norm = p => p.replace(/\\/g, '/')
	const root = workspaceRoot ? norm(workspaceRoot).replace(/\/+$/, '') : ''
	let dir = norm(filePath).replace(/[^/]+$/, '').replace(/\/+$/, '') || '.'
	const relFromRoot = (() => {
		if (!root) return norm(filePath)
		return norm(filePath).startsWith(root + '/') ? norm(filePath).slice(root.length + 1) : norm(filePath)
	})()

	for (let depth = 0; depth < 32; depth++) {
		const entries = await executor.listDir(dir).catch(() => [])
		if (entries.length) {
			const agentsFile = entries.find(e => e.isFile && e.name.toLowerCase() === 'agents.md')
			if (agentsFile && !seen.has(agentsFile.name + '@' + dir)) {
				seen.add(agentsFile.name + '@' + dir)
				const content = await executor.readTextFile(dir + '/' + agentsFile.name).catch(() => null)
				if (content != null) agents.push({ path: dir + '/' + agentsFile.name, content })
			}
			const docsDir = entries.find(e => e.isDirectory && e.name === '.agents')
			if (docsDir) {
				const docEntries = await executor.listDir(dir + '/.agents/docs').catch(() => [])
				for (const doc of docEntries.filter(e => e.isFile && e.name.endsWith('.md'))) {
					const docPath = dir + '/.agents/docs/' + doc.name
					if (seen.has(docPath)) continue
					seen.add(docPath)
					const content = await executor.readTextFile(docPath).catch(() => null)
					if (content == null) continue
					const { glob } = parseFrontmatter(content)
					if (!glob) continue
					if (!globToRegExp(glob).test(relFromRoot)) continue
					docs.push({ path: docPath, content })
				}
			}
		}
		if (!root || dir === root || !dir.includes('/')) break
		dir = dir.replace(/\/[^/]+$/, '') || '/'
	}
	return { agents, docs }
}

/**
 * 将收集结果格式化为注入对话的文本块。
 * @param {upwardContext_t} context - 收集结果。
 * @returns {string} 文本（无内容时为空串）。
 */
export function formatUpwardContext(context) {
	const blocks = []
	for (const item of context.agents)
		blocks.push(`AGENTS.md（${item.path}）：\n\`\`\`\n${item.content}\n\`\`\``)
	for (const item of context.docs)
		blocks.push(`${item.path}：\n\`\`\`\n${item.content}\n\`\`\``)
	return blocks.join('\n\n')
}
