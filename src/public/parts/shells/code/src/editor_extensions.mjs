import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

/**
 * 判断规范路径是否位于规范目录内。
 * @param {string} directory - 已 realpath 的目录。
 * @param {string} candidate - 已 realpath 的候选路径。
 * @returns {boolean} 是否包含在内。
 */
function isWithinDirectory(directory, candidate) {
	const from = directory.replace(/[\\/]$/, '')
	return candidate === from || candidate.startsWith(from + path.sep)
}

/**
 * 只读取操作者编辑器配置目录内的文件。
 * @param {string} root - 规范配置目录。
 * @param {string} name - 相对资源路径。
 * @returns {Promise<string>} UTF-8 文本。
 */
async function readAsset(root, name) {
	if (path.isAbsolute(name)) throw new Error('Editor asset paths must be relative.')
	const resolved = await fs.realpath(path.resolve(root, name))
	if (!isWithinDirectory(root, resolved)) throw new Error('Editor asset escapes .fount directory.')
	const stat = await fs.stat(resolved)
	if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Editor assets must be files smaller than 2 MiB.')
	return fs.readFile(resolved, 'utf8')
}

/**
 * 加载用户显式安装的 TextMate 语法与浏览器格式化模块。
 * @param {string} userDirectory - 已认证的 fount 用户目录。
 * @returns {Promise<{languages: object[]}>} 可序列化的编辑器贡献集。
 */
export async function readEditorExtensions(userDirectory) {
	// 边界必须先 realpath：用户目录本身可能是符号链接（例如系统临时目录），
	// 用未解析的路径与解析后的 `.fount` 比较会把合法配置判成越界。
	// `.fount` 自身若是符号链接，realpath 会把它换成目标目录，所以包含判断仍然拦得住它。
	const boundary = await fs.realpath(userDirectory)
	let root
	try { root = await fs.realpath(path.join(userDirectory, '.fount')) }
	catch (error) { if (error.code === 'ENOENT') return { languages: [] }; throw error }
	if (!isWithinDirectory(boundary, root)) throw new Error('Editor configuration escapes the fount user directory.')
	let source
	try { source = await readAsset(root, 'editor.json') }
	catch (error) { if (error.code === 'ENOENT') return { languages: [] }; throw error }
	const config = JSON.parse(source)
	if (config.version !== 1 || !Array.isArray(config.languages) || config.languages.length > 64) throw new Error('Expected editor configuration version 1 and up to 64 languages.')
	const ids = new Set()
	const languages = []
	for (const definition of config.languages) {
		const { id, extensions = [], aliases = [], configuration = {} } = definition
		if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id) || ids.has(id)) throw new Error('Editor language IDs must be unique lowercase identifiers.')
		if (!Array.isArray(extensions) || extensions.some(value => typeof value !== 'string' || !/^\.[\w.-]+$/.test(value))) throw new Error('Editor extensions must be file suffixes starting with a dot.')
		if (!Array.isArray(aliases) || aliases.some(value => typeof value !== 'string')) throw new Error('Editor aliases must be strings.')
		ids.add(id)
		languages.push({ id, extensions, aliases, configuration,
			grammar: definition.grammar ? JSON.parse(await readAsset(root, definition.grammar)) : null,
			formatter: definition.formatter ? await readAsset(root, definition.formatter) : null,
		})
	}
	return { languages }
}
