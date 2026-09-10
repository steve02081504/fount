/**
 * 基于 ripgrep 的文件搜索（`<glob>` / `<grep>` 标签的执行层）。
 *
 * 使用 `npm:ripgrep`（ripgrep 的 WASM 构建，跨平台且**无需原生二进制**，Windows/Linux/macOS/Termux 一致可用）。
 * 导出的 `runRipgrep` 自包含、只依赖入参，可经 `targetExecutor.execJs` 在本地或远程机器上执行。
 *
 * @typedef {object} ripgrepParams_t
 * @property {'glob'|'grep'} mode - 搜索模式。
 * @property {string} [root] - 搜索根目录（绝对路径；缺省为进程工作目录）。
 * @property {string[]} [patterns] - glob 模式列表（mode='glob'，多模式为“或”关系）。
 * @property {string} [pattern] - 正则表达式（mode='grep'，Rust regex 语法）。
 * @property {string[]} [includes] - 文件名 glob 过滤器（mode='grep'）。
 * @property {boolean} [filesOnly] - 仅返回命中的文件路径（mode='grep'）。
 * @property {number} [limit] - 最大返回条数。
 *
 * @typedef {object} ripgrepMatch_t
 * @property {string} path - 相对 root 的路径（分隔符统一为 `/`）。
 * @property {number} line - 行号（1 起）。
 * @property {string} text - 该行内容（截断至 500 字符）。
 *
 * @typedef {object} ripgrepResult_t
 * @property {boolean} ok - 是否成功（false 时看 `error`）。
 * @property {'glob'|'grep'} mode - 实际模式。
 * @property {boolean} truncated - 是否因超过 limit 而截断。
 * @property {number} total - 截断前的命中总数。
 * @property {string[]} [files] - glob 模式的文件列表。
 * @property {ripgrepMatch_t[]} [matches] - grep 模式的匹配行。
 * @property {string} [error] - 失败原因。
 */

/**
 * 运行一次 ripgrep 文件搜索。
 * 自包含实现：不引用外部作用域，便于作为字符串在本地/远程 `async_eval` 中执行。
 * @param {ripgrepParams_t} params - 搜索参数。
 * @returns {Promise<ripgrepResult_t>} 搜索结果。
 */
export async function runRipgrep(params) {
	const { ripgrep } = await import('npm:ripgrep')
	const { default: path } = await import('node:path')

	const root = params.root || '.'
	const limit = params.limit > 0 ? params.limit : 100
	/**
	 * 将 ripgrep 输出的绝对路径转为相对 root 的 `/` 分隔路径。
	 * @param {string} p - 绝对路径。
	 * @returns {string} 相对路径。
	 */
	const toRelative = p => (path.relative(root, p) || p).replace(/\\/g, '/')

	/**
	 * 执行 ripgrep 并返回 { code, stdout, stderr }。
	 * @param {string[]} args - ripgrep 参数。
	 * @returns {Promise<{code: number, stdout: string, stderr: string}>} 执行结果。
	 */
	const exec = async args => {
		const { code, stdout, stderr } = await ripgrep(args, { buffer: true })
		return { code, stdout: String(stdout || ''), stderr: String(stderr || '') }
	}

	if (params.mode === 'glob') {
		const args = ['--files']
		for (const glob of params.patterns || []) args.push('--glob', glob)
		args.push(root)
		const { code, stdout, stderr } = await exec(args)
		if (code > 1) return { ok: false, mode: 'glob', truncated: false, total: 0, error: stderr || `ripgrep exited with code ${code}` }
		const files = stdout.split('\n').map(line => line.trim()).filter(Boolean).map(toRelative).sort()
		return { ok: true, mode: 'glob', truncated: files.length > limit, total: files.length, files: files.slice(0, limit) }
	}

	const globArgs = []
	for (const glob of params.includes || []) globArgs.push('--glob', glob)

	if (params.filesOnly) {
		const args = ['--files-with-matches']
		if (params.pattern) args.push('-e', params.pattern)
		args.push(...globArgs, root)
		const { code, stdout, stderr } = await exec(args)
		if (code > 1) return { ok: false, mode: 'grep', truncated: false, total: 0, error: stderr || `ripgrep exited with code ${code}` }
		const files = stdout.split('\n').map(line => line.trim()).filter(Boolean).map(toRelative).sort()
		return { ok: true, mode: 'grep', truncated: files.length > limit, total: files.length, files: files.slice(0, limit) }
	}

	const args = ['--json']
	if (params.pattern) args.push('-e', params.pattern)
	args.push(...globArgs, root)
	const { code, stdout, stderr } = await exec(args)
	if (code > 1) return { ok: false, mode: 'grep', truncated: false, total: 0, error: stderr || `ripgrep exited with code ${code}` }

	/** @type {ripgrepMatch_t[]} */
	const matches = []
	let total = 0
	for (const line of stdout.split('\n')) {
		if (!line) continue
		/** @type {{type?: string, data?: any}} */
		let record
		try { record = JSON.parse(line) }
		catch { continue }
		if (record?.type !== 'match') continue
		total++
		if (matches.length >= limit) continue
		matches.push({
			path: toRelative(record.data?.path?.text ?? ''),
			line: record.data?.line_number ?? 0,
			text: String(record.data?.lines?.text ?? '').replace(/\r?\n$/, '').slice(0, 500),
		})
	}
	matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
	return { ok: true, mode: 'grep', truncated: total > limit, total, matches }
}
