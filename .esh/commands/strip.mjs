import fs from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import process from 'node:process'

import { parse as babelParse } from 'npm:@babel/parser'
import chalk from 'npm:chalk'
import { glob } from 'npm:glob'
import createIgnore from 'npm:ignore'
import { parseHTML } from 'npm:linkedom'
import minimist from 'npm:minimist'

/**
 * 项目配置
 */
class ProjectConfig {
	static FOUNT_DIR = resolve(process.cwd())
	static ENTRY_POINTS = [
		'src/server/index.mjs',
		'**/index.html',
		'src/public/parts/shells/*/main.mjs',
	]
	static PATH_MAPS = {
		'.github/pages/scripts/': 'src/public/pages/scripts/',
		'src/public/parts/scripts/': 'src/public/pages/scripts/',
		'src/public/parts/shells/scripts/': 'src/public/pages/scripts/',
		'/': 'src/public/pages/',
	}
	static IGNORED_IMPORT_PREFIXES = ['node:', 'npm:', 'https:']
}

/**
 * 解析后的模块
 */
class ParsedModule {
	/**
	 * 表示一个解析后的模块，包含其文件路径、类型、导入和导出信息。
	 * @param {string} filepath - 模块的文件路径。
	 * @param {string} type - 模块的类型（例如 'mjs' 或 'html'）。
	 */
	constructor(filepath, type) {
		this.filepath = filepath; this.type = type
		this.imports = new Map(); this.exports = new Set()
		this.unusedImports = new Map()
	}
}

/**
 * 文件扫描器
 */
class FileScanner {
	#config
	#ignoreFilter = createIgnore()

	/**
	 * 构造函数，初始化文件扫描器。
	 * @param {ProjectConfig} config - 项目配置对象。
	 */
	constructor(config) {
		this.#config = config
	}

	/**
	 * 初始化文件扫描器，加载 .gitignore 文件。
	 * @returns {Promise<void>}
	 */
	async init() {
		try {
			const gitignorePath = join(this.#config.FOUNT_DIR, '.gitignore')
			const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8')
			this.#ignoreFilter.add(gitignoreContent)
		} catch (error) {
			if (error.code === 'ENOENT')
				console.warn(chalk.yellow('Warning: .gitignore file not found.'))
			else throw error
		}
	}

	/**
	 * 查找项目中的文件。
	 * @param {string[]} extensions - 要查找的文件扩展名数组（例如 ['.mjs', '.html']）。
	 * @returns {Promise<string[]>} - 匹配到的文件路径数组。
	 */
	async findProjectFiles(extensions) {
		const pattern = `**/*.{${extensions.map(e => e.replace('.', '')).join(',')}}`
		const files = await glob(pattern, {
			cwd: this.#config.FOUNT_DIR,
			nodir: true,
			absolute: true,
		})

		return files.filter(file => !this.#ignoreFilter.ignores(relative(this.#config.FOUNT_DIR, file)))
	}
}

/**
 * 路径解析器
 */
class PathResolver {
	#config
	/**
	 * 构造函数，初始化路径解析器。
	 * @param {ProjectConfig} config - 项目配置对象。
	 */
	constructor(config) { this.#config = config }

	/**
	 * 解析导入路径。
	 * @param {string} importPath - 导入路径。
	 * @param {string} currentFileDir - 当前文件所在的目录。
	 * @returns {Promise<string>} - 解析后的绝对路径。
	 */
	async resolve(importPath, currentFileDir) {
		for (const [key, value] of Object.entries(this.#config.PATH_MAPS))
			if (importPath.startsWith(key)) {
				const newPath = value + importPath.substring(key.length)
				return this.#normalizeAndCheck(join(this.#config.FOUNT_DIR, newPath))
			}

		let resolvedPath
		if (importPath.startsWith('./') || importPath.startsWith('../'))
			resolvedPath = join(currentFileDir, importPath)
		else if (importPath.startsWith('/'))
			resolvedPath = join(this.#config.FOUNT_DIR, importPath.substring(1))
		else {
			const defaultPath = this.#config.PATH_MAPS['/'] || 'src/public/pages/'
			resolvedPath = join(this.#config.FOUNT_DIR, defaultPath, importPath)
		}
		return this.#normalizeAndCheck(resolvedPath)
	}

	/**
	 * 规范化并检查路径是否存在。
	 * @param {string} path - 要检查的路径。
	 * @returns {Promise<string|null>} - 如果路径存在且是文件，则返回规范化后的路径；否则返回 null。
	 */
	async #normalizeAndCheck(path) {
		/**
		 * 检查给定路径的文件是否存在。
		 * @param {string} p - 要检查的路径。
		 * @returns {Promise<string|null>} - 如果文件存在，则返回路径；否则返回 null。
		 */
		const checkExists = async (p) => {
			try {
				const stat = await fs.promises.stat(p)
				return stat.isFile() ? p : null
			} catch { return null }
		}
		const resolvedPath = resolve(path)
		if (await checkExists(resolvedPath)) return resolvedPath
		if (await checkExists(resolvedPath + '.mjs')) return resolvedPath + '.mjs'
		const indexPath = join(resolvedPath, 'index.mjs')
		if (await checkExists(indexPath)) return indexPath
		return resolvedPath
	}
}

/**
 * AST 解析器
 */
class AstParser {
	#config
	#pathResolver

	/**
	 * 构造函数，初始化 AST 解析器。
	 * @param {ProjectConfig} config - 项目配置对象。
	 * @param {PathResolver} pathResolver - 路径解析器实例。
	 */
	constructor(config, pathResolver) {
		this.#config = config
		this.#pathResolver = pathResolver
	}

	/**
	 * 解析指定文件。
	 * @param {string} filepath - 要解析的文件路径。
	 * @returns {Promise<ParsedModule|null>} - 解析后的模块对象，如果解析失败则返回 null。
	 */
	async parseFile(filepath) {
		try {
			const content = await fs.promises.readFile(filepath, 'utf-8')
			if (filepath.endsWith('.mjs'))
				return await this.#parseMjs(filepath, content)

			if (filepath.endsWith('.html'))
				return await this.#parseHtml(filepath, content)
		} catch (error) {
			console.error(chalk.red(`Error reading or parsing file ${filepath}:`), error)
			return null
		}
	}

	/**
	 * 解析 MJS 文件。
	 * @param {string} filepath - MJS 文件的路径。
	 * @param {string} content - MJS 文件的内容。
	 * @returns {Promise<ParsedModule>} - 解析后的模块对象。
	 */
	async #parseMjs(filepath, content) {
		const module = new ParsedModule(filepath, 'mjs')
		const currentFileDir = dirname(filepath)

		try {
			const ast = babelParse(content, {
				sourceType: 'module',
				plugins: ['importAssertions'],
				requireConfigFile: false,
				ecmaFeatures: {
					globalReturn: true
				}
			})

			for (const node of ast.program.body) {
				// Handle Imports
				if (node.type === 'ImportDeclaration') {
					const source = node.source.value
					if (this.#config.IGNORED_IMPORT_PREFIXES.some(p => source.startsWith(p))) continue

					const resolvedPath = await this.#pathResolver.resolve(source, currentFileDir)
					if (!module.imports.has(resolvedPath)) module.imports.set(resolvedPath, new Set())

					if (!node.specifiers.length)
						module.imports.get(resolvedPath).add('SIDE-EFFECT')
					else
						for (const spec of node.specifiers) {
							const { name } = spec.local
							if (spec.type === 'ImportNamespaceSpecifier')
								module.imports.get(resolvedPath).add(`*${name}`)
							else
								module.imports.get(resolvedPath).add(name)
						}
				}

				// Handle Exports
				if (node.type === 'ExportNamedDeclaration') {
					if (node.declaration) {
						if (node.declaration.declarations)  // export const a = 1
							for (const decl of node.declaration.declarations) module.exports.add(decl.id.name)
						else if (node.declaration.id)  // export function a() {}
							module.exports.add(node.declaration.id.name)
					}
					else if (node.specifiers)  // export { a, b as c };
						for (const spec of node.specifiers) module.exports.add(spec.exported.name)
				}
				else if (node.type === 'ExportDefaultDeclaration')
					if (node.declaration.id) module.exports.add(node.declaration.id.name)
					else module.exports.add('default')
				else if (node.type === 'ExportAllDeclaration') {
					const source = node.source.value
					const resolvedPath = await this.#pathResolver.resolve(source, currentFileDir)
					if (!module.imports.has(resolvedPath)) module.imports.set(resolvedPath, new Set())
					module.imports.get(resolvedPath).add('RE-EXPORT-ALL')
				}
			}
		} catch (e) {
			console.warn(chalk.yellow(`Could not parse AST for ${filepath}. Skipping.`), e.message)
		}
		return module
	}

	/**
	 * 解析 HTML 文件。
	 * @param {string} filepath - HTML 文件的路径。
	 * @param {string} content - HTML 文件的内容。
	 * @returns {Promise<ParsedModule>} - 解析后的模块对象。
	 */
	async #parseHtml(filepath, content) {
		const module = new ParsedModule(filepath, 'html')
		const currentFileDir = dirname(filepath)
		const { document } = parseHTML(content)
		const scripts = document.querySelectorAll('script[type="module"]')
		for (const script of scripts) {
			const src = script.getAttribute('src')
			if (src) {
				const resolvedPath = await this.#pathResolver.resolve(src, currentFileDir)
				if (!module.imports.has(resolvedPath)) module.imports.set(resolvedPath, new Set())
				module.imports.get(resolvedPath).add('DYNAMIC')
			}
			else if (script.textContent) {
				const inlineModule = await this.#parseMjs(`${filepath}#inline`, script.textContent)
				if (inlineModule)
					for (const [path, names] of inlineModule.imports.entries()) {
						if (!module.imports.has(path)) module.imports.set(path, new Set())
						names.forEach(name => module.imports.get(path).add(name))
					}
			}
		}
		return module
	}
}

/**
 * 依赖分析器
 */
class DependencyAnalyzer {
	#config; #allModules
	dependencyGraph = new Map(); usedExports = new Map()
	/**
	 * 构造函数，初始化依赖分析器。
	 * @param {ProjectConfig} config - 项目配置对象。
	 * @param {Map<string, ParsedModule>} allModules - 所有解析过的模块的映射。
	 */
	constructor(config, allModules) { this.#config = config; this.#allModules = allModules }

	/**
	 * 分析模块依赖关系。
	 * @returns {Promise<void>}
	 */
	async analyze() {
		const entryPoints = await this.#resolveEntryPoints()
		const queue = [...entryPoints]; const visited = new Set()
		while (queue.length) {
			const filepath = queue.shift(); if (visited.has(filepath)) continue; visited.add(filepath)
			const module = this.#allModules.get(filepath); if (!module) continue
			if (!this.dependencyGraph.has(filepath)) this.dependencyGraph.set(filepath, new Set())
			for (const [importedPath, importedNames] of module.imports.entries()) {
				this.dependencyGraph.get(filepath).add(importedPath)
				if (!visited.has(importedPath)) queue.push(importedPath)
				const importedModule = this.#allModules.get(importedPath); if (!importedModule) continue
				if (!this.usedExports.has(importedPath)) this.usedExports.set(importedPath, new Set())
				for (const name of importedNames)
					if (name.startsWith('*') || ['DYNAMIC', 'SIDE-EFFECT', 'RE-EXPORT-ALL'].includes(name)) {
						importedModule.exports.forEach(exp => this.usedExports.get(importedPath).add(exp)); break
					} else this.usedExports.get(importedPath).add(name)
			}
		}
	}

	/**
	 * 解析入口点。
	 * @returns {Promise<Set<string>>} - 解析后的入口点集合。
	 */
	async #resolveEntryPoints() {
		const entryPointPromises = this.#config.ENTRY_POINTS.map(pattern =>
			glob(pattern, { cwd: this.#config.FOUNT_DIR, absolute: true })
		)
		const allMatches = await Promise.all(entryPointPromises)
		return new Set(allMatches.flat())
	}
}

/**
 * 报告生成器
 */
class ReportGenerator {
	#config; #allModules; #usedExports; #args
	issueFound = false

	/**
	 * 构造函数，初始化报告生成器。
	 * @param {ProjectConfig} config - 项目配置对象。
	 * @param {Map<string, ParsedModule>} allModules - 所有解析过的模块的映射。
	 * @param {Map<string, Set<string>>} usedExports - 已使用的导出项的映射。
	 * @param {object} args - 命令行参数。
	 */
	constructor(config, allModules, usedExports, args) {
		this.#config = config; this.#allModules = allModules
		this.#usedExports = usedExports; this.#args = args
	}

	/**
	 * 报告一个问题。
	 * @param {string} message - 要报告的问题消息。
	 */
	#reportIssue(message) {
		console.log(message)
		this.issueFound = true
	}

	/**
	 * 运行所有报告。
	 * @returns {void}
	 */
	runAllReports() {
		this.reportUnusedExports()
	}

	/**
	 * 报告未使用的导出项。
	 * @returns {void}
	 */
	reportUnusedExports() {
		console.log(chalk.bold('\n--- Unused Exports Analysis ---'))
		let foundIssuesInReport = false
		const sortedPaths = [...this.#allModules.keys()].sort()

		for (const filepath of sortedPaths) {
			const module = this.#allModules.get(filepath)
			if (module.type !== 'mjs' || !module.exports.size) continue

			const used = this.#usedExports.get(filepath) || new Set()
			const unusedExports = [...module.exports].filter(exp => !used.has(exp))

			if (unusedExports.length) {
				const relPath = relative(this.#config.FOUNT_DIR, filepath)
				this.#reportIssue(
					`File: ${chalk.yellow(relPath)}\n  - ${chalk.red('Unused exports:')} ${unusedExports.join(', ')}`
				)
				foundIssuesInReport = true
				if (this.#args['single-warning']) return
			}
		}

		if (!foundIssuesInReport)
			console.log(chalk.green('No unused exports found.'))
	}
}

/**
 * 主函数，执行文件分析和报告生成。
 * @returns {Promise<void>}
 */
async function main() {
	const args = minimist(process.argv.slice(2), {
		boolean: ['single-warning'],
		alias: { s: 'single-warning' },
	})

	const config = ProjectConfig
	const scanner = new FileScanner(config)
	await scanner.init()

	const pathResolver = new PathResolver(config)
	const parser = new AstParser(config, pathResolver)

	const allFiles = await scanner.findProjectFiles(['.mjs', '.html'])
	console.log(`Analyzing ${allFiles.length} files...`)

	const allModules = new Map()
	const parsePromises = allFiles.map(async (filepath) => {
		const module = await parser.parseFile(filepath)
		if (module) allModules.set(filepath, module)
	})
	await Promise.all(parsePromises)

	const analyzer = new DependencyAnalyzer(config, allModules)
	await analyzer.analyze()

	const reporter = new ReportGenerator(config, allModules, analyzer.usedExports, args)
	reporter.runAllReports()
}

if (import.meta.main) await main()
