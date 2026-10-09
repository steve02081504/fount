/**
 * 文件搜索（`<glob>` / `<grep>` 标签的执行层）。
 *
 * 优先用 tgrep 已建好的索引（code shell 为打开的工作区启动索引服务，见 `indexRoot`），
 * 其次退回 PATH 上的 `rg`，最后是 `npm:ripgrep`（ripgrep 的 WASM 构建，跨平台且**无需原生二进制**，
 * Windows/Linux/macOS/Termux 一致可用）。
 * 导出的 `runRipgrep` 自包含、只依赖入参，可经 `targetExecutor.execJs` 在本地或远程机器上执行。
 *
 * @typedef {object} ripgrepParams_t
 * @property {'glob'|'grep'} mode - 搜索模式。
 * @property {string} [root] - 搜索根目录（绝对路径；缺省为进程工作目录）。
 * @property {string[]} [patterns] - 相对 root 的 glob 模式列表（mode='glob'，多模式为“或”关系；末尾 / 匹配目录）。
 * @property {string} [pattern] - 正则表达式（mode='grep'，Rust regex 语法）。
 * @property {string[]} [includes] - 文件名 glob 过滤器（mode='grep'）。
 * @property {boolean} [filesOnly] - 仅返回命中的文件路径（mode='grep'）。
 * @property {number} [limit] - 最大返回条数。
 * @property {string} [indexRoot] - 工作区索引根目录；缺省时在本机向上发现最近的 Git 仓库索引。
 * @property {string|number} [machine] - 执行机器（`> 0` 为远端）；只有本机能建索引。
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
 * @property {Array<{pattern: string, count: number}>} [patterns] - glob 模式下每个模式各自的命中数（仅多个模式时返回，供零命中提示）。
 * @property {ripgrepMatch_t[]} [matches] - grep 模式的匹配行。
 * @property {string} [error] - 失败原因。
 */

/**
 * 运行一次文件搜索。
 * 自包含实现：不引用外部作用域，便于作为字符串在本地/远程 `async_eval` 中执行。
 * @param {ripgrepParams_t} params - 搜索参数。
 * @returns {Promise<ripgrepResult_t>} 搜索结果。
 */
export async function runRipgrep(params) {
	const { default: fs } = await import('node:fs/promises')
	const { default: path } = await import('node:path')
	const { default: os } = await import('node:os')
	const { default: process } = await import('node:process')
	const { createHash } = await import('node:crypto')

	const root = params.root || '.'
	const limit = params.limit > 0 ? params.limit : 100
	/**
	 * 将 ripgrep 输出路径转为相对 root 的 `/` 分隔路径。
	 * @param {string} p - 绝对或相对路径。
	 * @returns {string} 相对路径。
	 */
	const toRelative = p => (path.relative(path.isAbsolute(p) ? root : '.', p) || p).replace(/\\/g, '/')
	/**
	 * 路径是否为普通文件；不存在时为 false。
	 * @param {string} target - 绝对路径。
	 * @returns {Promise<boolean>} 是否为文件。
	 */
	const isFile = async target => (await fs.stat(target).catch(() => null))?.isFile() ?? false
	/**
	 * 路径是否为目录；不存在时为 false。
	 * @param {string} target - 绝对路径。
	 * @returns {Promise<boolean>} 是否为目录。
	 */
	const isDir = async target => (await fs.stat(target).catch(() => null))?.isDirectory() ?? false

	let indexRoot = params.indexRoot && path.resolve(params.indexRoot)
	/** @type {Promise<void>|undefined} */
	let discoveryPromise
	/**
	 * 首次调用才向上寻找最近的 Git 仓库并记账，之后复用同一结果。
	 * 只有本机（machine 0）能起索引服务：远端连模块都取不到，不做无用功。
	 * @returns {Promise<void>} 发现完成。
	 */
	const discovery = () => discoveryPromise ??= findIndexRoot().catch(error => console.warn('file-operations search index:', error))
	/**
	 * 向上寻找最近的 Git 仓库，索引目录已存在则直接用，否则后台起索引。
	 * @returns {Promise<void>} 发现完成。
	 */
	async function findIndexRoot() {
		if (indexRoot || params.machine > 0) return
		const start = path.resolve(root)
		let dir = await isFile(start) ? path.dirname(start) : start
		for (;;) {
			if (await isFile(path.join(dir, '.git', 'config'))) {
				// 索引目录必须与 code shell 的 search_index.mjs 算得一致，那里同时起着 `tgrep serve`。
				const indexKey = process.platform === 'win32' ? dir.toLowerCase() : dir
				const index = path.join(os.tmpdir(), 'tgrep', createHash('sha256').update(indexKey).digest('hex'))
				if (await isDir(index)) indexRoot = dir
				const { pathToFileURL } = await import('node:url')
				const { startWorkspaceSearchIndex } = await import(pathToFileURL(path.resolve('src/public/parts/shells/code/src/search_index.mjs')).href)
				void startWorkspaceSearchIndex({ path: dir }).catch(error => console.warn('file-operations search index:', error))
				return
			}
			const parent = path.dirname(dir)
			if (parent === dir) return
			dir = parent
		}
	}
	/**
	 * 拼上索引参数后的 tgrep 参数。
	 * tgrep 把重复的全局开关当参数冲突报错，而各搜索模式自己也会带 `--no-require-git`。
	 * @param {string[]} args - 搜索参数。
	 * @returns {string[]} 去重后的参数。
	 */
	const withIndex = args => [...new Set([
		'--index-path', path.join(os.tmpdir(), 'tgrep', createHash('sha256').update(process.platform === 'win32' ? indexRoot.toLowerCase() : indexRoot).digest('hex')),
		'--no-require-git', ...args,
	])]
	/**
	 * 执行搜索命令，返回 { code, stdout, stderr }。
	 * @param {string[]} args - 搜索参数。
	 * @param {object} [options] - WASI 预打开目录等选项。
	 * @returns {Promise<{code: number, stdout: string, stderr: string}>} 执行结果。
	 */
	const exec = async (args, options = {}) => {
		const cwd = options.preopens?.['.'] || undefined
		// 没有索引就先并行搜起来：向上定位仓库与建索引不阻塞这次搜索。
		const earlyRg = indexRoot ? null : new globalThis.Deno.Command('rg', {
			args, cwd, stdout: 'piped', stderr: 'piped',
		}).output().catch(() => null)
		await discovery()
		const candidates = indexRoot
			? [
				{ name: 'tgrep', args: withIndex(args) },
				{ name: path.join(os.tmpdir(), 'fount', 'bin', process.platform === 'win32' ? 'tgrep.exe' : 'tgrep'), args: withIndex(args) },
				{ name: 'rg', args },
			]
			: [{ name: 'rg', args }]
		let lastFailure
		for (const candidate of candidates)
			try {
				const output = candidate.name === 'rg' && earlyRg ? await earlyRg : await new globalThis.Deno.Command(candidate.name, {
					args: candidate.args, cwd, stdout: 'piped', stderr: 'piped',
				}).output()
				if (!output) continue
				const result = { code: output.code, stdout: new TextDecoder().decode(output.stdout), stderr: new TextDecoder().decode(output.stderr) }
				if (result.code <= 1) return result
				lastFailure = result
			}
			catch (error) { lastFailure = error }
		try {
			const { ripgrep } = await import('npm:ripgrep')
			const { code, stdout, stderr } = await ripgrep(args, { buffer: true, ...options })
			return { code, stdout: String(stdout || ''), stderr: String(stderr || '') }
		}
		catch (error) {
			if (lastFailure?.code != null) return lastFailure
			throw error
		}
	}

	if (params.mode === 'glob') {
		const patterns = params.patterns || []
		const filePatterns = patterns.filter(glob => !glob.endsWith('/'))
		const dirPatterns = patterns.filter(glob => glob.endsWith('/'))
		const { default: picomatch } = await import('npm:picomatch')
		const args = ['--files', '--no-require-git', '.']
		// WASI 的 `.` 指向搜索根：传绝对 root 作为位置参数会让含目录段的 glob
		// 从进程工作目录而非搜索根开始匹配（`*/main.mjs` 等因此失效）。
		// 让 rg 负责忽略规则，随后按相对路径匹配；正向 -g 会越过 .gitignore。
		const { code, stdout, stderr } = filePatterns.length || !dirPatterns.length
			? await exec(args, { preopens: { '.': root } })
			: { code: 0, stdout: '', stderr: '' }
		if (code > 1) return { ok: false, mode: 'glob', truncated: false, total: 0, error: stderr || `ripgrep exited with code ${code}` }
		const fileMatches = filePatterns.map(glob => picomatch(glob, { basename: !glob.includes('/') }))
		const dirMatches = dirPatterns.map(glob => picomatch(glob.slice(0, -1), { dot: false }))
		const files = stdout.split('\n').map(line => line.trim()).filter(Boolean).map(toRelative)
			.filter(file => !filePatterns.length || fileMatches.some(match => match(file)))
		if (dirPatterns.length) {
			const maxDepth = dirPatterns.some(glob => glob.includes('**'))
				? Infinity
				: Math.max(...dirPatterns.map(glob => glob.slice(0, -1).split('/').length))
			/**
			 * 遍历目录并沿用父级忽略规则，包含空目录。
			 * @param {string} dir - 当前绝对目录。
			 * @param {string} relative - 相对搜索根的目录。
			 * @param {Array<{base: string, negated: boolean, matches: (candidate: string) => boolean}>} inherited - 上层忽略规则。
			 * @returns {Promise<void>} 遍历完成。
			 */
			const visit = async (dir, relative = '', inherited = []) => {
				const rules = [...inherited]
				for (const filename of ['.gitignore', '.ignore']) {
					const contents = await fs.readFile(path.join(dir, filename), 'utf8').catch(() => '')
					for (const raw of contents.split(/\r?\n/)) {
						const line = raw.trim()
						if (!line || line.startsWith('#')) continue
						const negated = line.startsWith('!')
						const pattern = (negated ? line.slice(1) : line).replace(/\/$/, '')
						const anchored = pattern.startsWith('/') || pattern.includes('/')
						const normalized = pattern.replace(/^\//, '')
						const match = picomatch(normalized, { dot: true })
						rules.push({
							negated,
							base: relative,
							/**
							 * 判断规则是否命中相对于其所在目录的路径。
							 * @param {string} candidate - 待判断的相对路径。
							 * @returns {boolean} 是否匹配。
							 */
							matches: candidate => match(anchored ? candidate : candidate.split('/').at(-1)),
						})
					}
				}
				for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
					if (!entry.isDirectory() || entry.name.startsWith('.')) continue
					const rel = relative ? `${relative}/${entry.name}` : entry.name
					let ignored = false
					for (const rule of rules)
						if ((!rule.base || rel.startsWith(`${rule.base}/`)) && rule.matches(rule.base ? rel.slice(rule.base.length + 1) : rel))
							ignored = !rule.negated
					if (ignored) continue
					if (dirMatches.some(match => match(rel))) files.push(`${rel}/`)
					if (rel.split('/').length < maxDepth) await visit(path.join(dir, entry.name), rel, rules)
				}
			}
			await visit(root)
		}
		files.sort()
		// 多模式时按模式分别统计命中，供上层对 0 命中的模式单独警示（含 / 的模式相对起始目录解析，易写错）。
		const patternStats = patterns.length > 1 ? (() => {
			const fileEntries = files.filter(file => !file.endsWith('/'))
			const dirEntries = files.filter(file => file.endsWith('/')).map(file => file.slice(0, -1))
			return [
				...filePatterns.map((pattern, i) => ({ pattern, count: fileEntries.filter(file => fileMatches[i](file)).length })),
				...dirPatterns.map((pattern, i) => ({ pattern, count: dirEntries.filter(dir => dirMatches[i](dir)).length })),
			]
		})() : undefined
		return {
			ok: true, mode: 'glob', truncated: files.length > limit, total: files.length,
			files: files.slice(0, limit), ...patternStats ? { patterns: patternStats } : {},
		}
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
