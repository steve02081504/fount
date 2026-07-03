/**
 * Shell 前后端模块加载探针：快速发现跨界 import 与无法解析的静态依赖。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IMPORT_RE = /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

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
 * @param {string} repoRoot 仓库根
 * @param {string} importerFile 当前模块绝对路径
 * @param {string} spec import 说明符
 * @returns {string | null} 解析后的绝对路径（仅文件系统目标）
 */
export function resolveBrowserImportSpec(repoRoot, importerFile, spec) {
	if (spec.startsWith('https://') || spec.startsWith('http://') || spec.startsWith('npm:') || spec.startsWith('node:'))
		return null

	if (spec.startsWith('/scripts/test/')) {
		const rel = spec.slice('/scripts/test/'.length)
		const candidate = path.join(repoRoot, 'src/scripts/test', rel)
		return existsSync(candidate) ? candidate : null
	}

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
 * @returns {Promise<string[]>} 文件中所有静态 import 说明符
 */
async function extractImportSpecs(file) {
	const text = await readFile(file, 'utf8')
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
 * @param {object} options 参数
 * @param {string} options.repoRoot 仓库根
 * @param {string} options.partPath shells/chat 或 shells/social
 * @returns {Promise<{ backendMissing: string[], publicMissing: string[], crossBoundary: string[] }>} 探针结果
 */
export async function probeShellPart({ repoRoot, partPath }) {
	const partDir = path.join(repoRoot, 'src/public/parts', partPath.replace(/:/g, '/'))
	const publicDir = path.join(partDir, 'public')
	const srcDir = path.join(partDir, 'src')

	/** @type {string[]} */
	const publicMissing = []
	/** @type {string[]} */
	const backendMissing = []
	/** @type {string[]} */
	const crossBoundary = []

	for (const file of await walkMjsFiles(publicDir)) 
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
	

	for (const file of await walkMjsFiles(srcDir)) 
		for (const spec of await extractImportSpecs(file)) {
			if (!spec.startsWith('.')) continue
			if (!spec.includes('public/')) continue
			const resolved = resolveBrowserImportSpec(repoRoot, file, spec)
			if (!resolved) {
				backendMissing.push(`${path.relative(repoRoot, file)} -> ${spec}`)
				continue
			}
			const rel = path.relative(repoRoot, resolved).replace(/\\/g, '/')
			if (rel.includes('/public/src/') && !rel.includes('/public/shared/'))
				crossBoundary.push(`backend ${path.relative(repoRoot, file)} imports frontend-only ${rel}`)
			if (rel.includes('/public/pages/'))
				crossBoundary.push(`backend ${path.relative(repoRoot, file)} imports pages ${rel}`)
		}
	

	/** 动态 import 验证关键后端链（不执行 main 全量副作用）。 */
	const dynamicProbes = [
		path.join(partDir, 'src/group/routes/channelCrud.mjs'),
		path.join(partDir, 'public/shared/friendBinding.mjs'),
	]
	for (const probe of dynamicProbes) {
		if (!existsSync(probe)) continue
		try {
			await import(pathToFileURL(probe).href)
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('Module not found'))
				backendMissing.push(`${path.relative(repoRoot, probe)} (dynamic): ${message}`)
		}
	}

	return { backendMissing, publicMissing, crossBoundary }
}

/**
 * @param {string} [repoRoot] 仓库根；默认从本文件向上推断
 * @returns {string} 仓库根目录绝对路径
 */
export function defaultRepoRoot(repoRoot) {
	if (repoRoot) return repoRoot
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}
