/**
 * Shell 前后端模块加载探针：快速发现跨界 import、无法解析的静态依赖、以及缺失的具名导出。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IMPORT_RE = /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu
const NAMED_IMPORT_RE = /\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu
const EXPORT_DECL_RE = /\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gu
const EXPORT_LIST_RE = /\bexport\s*\{([^}]+)\}\s*(?:from\s*['"]([^'"]+)['"])?/gu
const EXPORT_STAR_RE = /\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s*['"]([^'"]+)['"]/gu
const EXPORT_DEFAULT_RE = /\bexport\s+default\b/u

/**
 * @param {string} repoRoot 仓库根目录
 * @returns {string} pages/scripts 根路径
 */
function pagesScriptsRoot(repoRoot) {
	return path.join(repoRoot, 'src/public/pages/scripts')
}

/**
 * @param {string} repoRoot 仓库根目录
 * @param {string} partPath 如 shells/chat
 * @returns {string} part public 根路径
 */
function partPublicRoot(repoRoot, partPath) {
	return path.join(repoRoot, 'src/public/parts', partPath.replace(/:/g, '/'), 'public')
}

/**
 * @param {string} source 源码
 * @returns {string} 去掉注释后的源码
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//gu, '')
		.replace(/(^|[^:\\])\/\/.*$/gmu, '$1')
}

/**
 * @param {string} clause `{ a, b as c, type D }` 内的片段
 * @param {'import' | 'export'} mode import 取源名，export 取对外名
 * @returns {string[]} 绑定名
 */
export function parseBindingNames(clause, mode = 'import') {
	/** @type {string[]} */
	const names = []
	for (const raw of clause.split(',')) {
		const part = raw.trim()
		if (!part || part === '...') continue
		const tokens = part.split(/\s+/u).filter(Boolean)
		if (!tokens.length) continue
		if (tokens[0] === 'type') tokens.shift()
		if (!tokens.length) continue
		if (mode === 'import') {
			names.push(tokens[0])
			continue
		}
		const asIdx = tokens.indexOf('as')
		names.push(asIdx >= 0 ? tokens[asIdx + 1] : tokens[0])
	}
	return names.filter(Boolean)
}

/**
 * @param {string} repoRoot 仓库根
 * @param {string} importerFile 当前模块绝对路径
 * @param {string} spec import 说明符
 * @returns {string | null} 解析后的绝对路径（仅文件系统目标）
 */
export function resolveBrowserImportSpec(repoRoot, importerFile, spec) {
	if (spec.startsWith('https://') || spec.startsWith('http://') || spec.startsWith('npm:') || spec.startsWith('node:'))
		return null

	if (spec.startsWith('/scripts/')) {
		const rel = spec.slice('/scripts/'.length)
		const candidate = path.join(pagesScriptsRoot(repoRoot), rel)
		return existsSync(candidate) ? candidate : null
	}

	if (spec.startsWith('/parts/')) {
		const body = spec.slice('/parts/'.length)
		const slash = body.indexOf('/')
		if (slash < 0) return null
		const partKey = body.slice(0, slash)
		const within = body.slice(slash + 1)
		const candidate = path.join(partPublicRoot(repoRoot, partKey), within)
		return existsSync(candidate) ? candidate : null
	}

	if (spec.startsWith('/')) return null

	if (!spec.startsWith('.') && !spec.startsWith('/'))
		return null

	const base = path.resolve(path.dirname(importerFile), spec)
	const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, path.join(base, 'index.mjs')]
	for (const candidate of candidates)
		if (existsSync(candidate)) return candidate
	return null
}

/**
 * @param {string} dir 目录
 * @returns {Promise<string[]>} 目录下所有 .mjs 文件路径
 */
async function walkMjsFiles(dir) {
	/** @type {string[]} */
	const out = []
	if (!existsSync(dir)) return out
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) out.push(...await walkMjsFiles(full))
		else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full)
	}
	return out
}

/**
 * @param {string} file 文件路径
 * @returns {Promise<string>} 去掉注释的源码
 */
async function readStripped(file) {
	return stripComments(await readFile(file, 'utf8'))
}

/**
 * @param {string} file 文件路径
 * @returns {Promise<string[]>} 文件中所有静态/动态 import 说明符（忽略注释内）
 */
async function extractImportSpecs(file) {
	const text = await readStripped(file)
	/** @type {string[]} */
	const specs = []
	for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
		re.lastIndex = 0
		let match
		while ((match = re.exec(text)) !== null)
			specs.push(match[1])
	}
	return specs
}

/**
 * @param {string} file 文件路径
 * @returns {Promise<{ spec: string, names: string[] }[]>} 具名静态 import
 */
export async function extractNamedImports(file) {
	const text = await readStripped(file)
	/** @type {{ spec: string, names: string[] }[]} */
	const out = []
	NAMED_IMPORT_RE.lastIndex = 0
	let match
	while ((match = NAMED_IMPORT_RE.exec(text)) !== null)
		out.push({ spec: match[2], names: parseBindingNames(match[1], 'import') })
	return out
}

/**
 * 静态收集模块导出的绑定名（跟随相对路径的 `export … from` / `export * from`）。
 * @param {string} repoRoot 仓库根
 * @param {string} file 模块绝对路径
 * @param {Map<string, Set<string>>} [cache] 缓存
 * @returns {Promise<Set<string>>} 导出名集合
 */
export async function collectModuleExports(repoRoot, file, cache = new Map()) {
	const key = path.resolve(file)
	if (cache.has(key)) return cache.get(key)

	/** @type {Set<string>} */
	const names = new Set()
	cache.set(key, names)

	if (!existsSync(key) || !key.endsWith('.mjs') && !key.endsWith('.js'))
		return names

	const text = await readStripped(key)

	EXPORT_DECL_RE.lastIndex = 0
	let match
	while ((match = EXPORT_DECL_RE.exec(text)) !== null)
		names.add(match[1])

	if (EXPORT_DEFAULT_RE.test(text))
		names.add('default')

	EXPORT_LIST_RE.lastIndex = 0
	while ((match = EXPORT_LIST_RE.exec(text)) !== null) 
		// `export { a as b } from 'npm:…'` — 对外名即本模块导出；远端是否可解析无关
		for (const name of parseBindingNames(match[1], 'export'))
			names.add(name)
	

	EXPORT_STAR_RE.lastIndex = 0
	while ((match = EXPORT_STAR_RE.exec(text)) !== null) {
		const fromSpec = match[1]
		const resolved = resolveBrowserImportSpec(repoRoot, key, fromSpec)
		if (!resolved) continue
		const star = await collectModuleExports(repoRoot, resolved, cache)
		for (const name of star)
			if (name !== 'default') names.add(name)
	}

	return names
}

/**
 * @param {object} options 参数
 * @param {string} options.repoRoot 仓库根
 * @param {string} options.partPath shells/chat 或 shells/social
 * @param {string[]} [options.dynamicProbes] 相对 part 根的动态 import 探针路径；省略则用默认
 * @returns {Promise<{ backendMissing: string[], publicMissing: string[], crossBoundary: string[], missingNamed: string[] }>} 探针结果
 */
export async function probeShellPart({ repoRoot, partPath, dynamicProbes }) {
	const partDir = path.join(repoRoot, 'src/public/parts', partPath.replace(/:/g, '/'))
	const publicDir = path.join(partDir, 'public')
	const srcDir = path.join(partDir, 'src')

	/** @type {string[]} */
	const publicMissing = []
	/** @type {string[]} */
	const backendMissing = []
	/** @type {string[]} */
	const crossBoundary = []
	/** @type {string[]} */
	const missingNamed = []
	/** @type {Map<string, Set<string>>} */
	const exportCache = new Map()

	/**
	 * @param {string} file 导入方
	 * @returns {Promise<void>}
	 */
	async function checkNamedImports(file) {
		for (const { spec, names } of await extractNamedImports(file)) {
			if (!names.length) continue
			if (!spec.startsWith('.') && !spec.startsWith('/')) continue
			if (spec.endsWith('.ts')) continue
			const resolved = resolveBrowserImportSpec(repoRoot, file, spec)
			if (!resolved) continue
			const exports = await collectModuleExports(repoRoot, resolved, exportCache)
			for (const name of names) {
				if (exports.has(name)) continue
				missingNamed.push(
					`${path.relative(repoRoot, file)} imports '${name}' from ${spec} (missing in ${path.relative(repoRoot, resolved)})`,
				)
			}
		}
	}

	for (const file of await walkMjsFiles(publicDir)) {
		for (const spec of await extractImportSpecs(file)) {
			if (spec.startsWith('/')) {
				const resolved = resolveBrowserImportSpec(repoRoot, file, spec)
				if (!resolved)
					publicMissing.push(`${path.relative(repoRoot, file)} -> ${spec}`)
				else {
					const rel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
					if (rel.includes('/src/scripts/') || rel.match(/parts\/shells\/[^/]+\/src\//))
						crossBoundary.push(`frontend ${path.relative(repoRoot, file)} imports backend ${rel} via ${spec}`)
				}
				continue
			}

			if (!spec.startsWith('.')) continue

			const resolved = resolveBrowserImportSpec(repoRoot, file, spec)
			if (!resolved) {
				if (spec.includes('/shared/') || spec.includes('public/shared'))
					publicMissing.push(`${path.relative(repoRoot, file)} -> ${spec}`)
				continue
			}

			const rel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
			if (rel.includes('/src/scripts/') || rel.match(/parts\/shells\/[^/]+\/src\//))
				crossBoundary.push(`frontend ${path.relative(repoRoot, file)} imports backend ${rel} via ${spec}`)
		}
		await checkNamedImports(file)
	}


	for (const file of await walkMjsFiles(srcDir)) {
		for (const spec of await extractImportSpecs(file)) {
			if (!spec.startsWith('.')) continue
			// `.ts` 是类型声明路径，不参与运行时模块图
			if (spec.endsWith('.ts')) continue
			const resolved = resolveBrowserImportSpec(repoRoot, file, spec)
			if (!resolved) {
				backendMissing.push(`${path.relative(repoRoot, file)} -> ${spec}`)
				continue
			}
			if (!spec.includes('public/')) continue
			const rel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
			if (rel.includes('/public/src/') && !rel.includes('/public/shared/'))
				crossBoundary.push(`backend ${path.relative(repoRoot, file)} imports frontend-only ${rel}`)
			if (rel.includes('/public/pages/'))
				crossBoundary.push(`backend ${path.relative(repoRoot, file)} imports pages ${rel}`)
		}
		await checkNamedImports(file)
	}


	/** 动态 import 验证关键后端链（不执行 main 全量副作用）。 */
	const probeRels = dynamicProbes ?? [
		'src/group/routes/channelCrud.mjs',
		'public/shared/friendBinding.mjs',
	]
	for (const rel of probeRels) {
		const probe = path.isAbsolute(rel) ? rel : path.join(partDir, rel)
		if (!existsSync(probe)) continue
		try {
			await import(pathToFileURL(probe).href)
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('Module not found') || message.includes('does not provide an export named'))
				backendMissing.push(`${path.relative(repoRoot, probe)} (dynamic): ${message}`)
		}
	}

	return { backendMissing, publicMissing, crossBoundary, missingNamed }
}

/**
 * @param {string} [repoRoot] 仓库根；默认从本文件向上推断
 * @returns {string} 仓库根目录绝对路径
 */
export function defaultRepoRoot(repoRoot) {
	if (repoRoot) return repoRoot
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}
