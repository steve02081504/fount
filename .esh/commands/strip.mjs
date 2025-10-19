import { promises as fs } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import process from 'node:process'

import { parse as babelParse } from 'npm:@babel/parser'
import chalk from 'npm:chalk'
import { glob } from 'npm:glob'
import createIgnore from 'npm:ignore'
import { parseHTML } from 'npm:linkedom'
import minimist from 'npm:minimist'

// --- 1. Configuration ---
class ProjectConfig {
	static FOUNT_DIR = resolve(process.cwd())
	static ENTRY_POINTS = [
		'src/server/index.mjs',
		'**/index.html',
		'src/public/shells/*/main.mjs',
	]
	static PATH_MAPS = {
		'.github/pages/scripts/': 'src/pages/scripts/',
		'src/public/scripts/': 'src/pages/scripts/',
		'src/public/shells/scripts/': 'src/pages/scripts/',
		'/': 'src/pages/',
	}
	static IGNORED_IMPORT_PREFIXES = ['node:', 'npm:', 'https:']
}

// --- 2. Data Model ---
class ParsedModule {
	constructor(filepath, type) {
		this.filepath = filepath; this.type = type
		this.imports = new Map(); this.exports = new Set()
		this.unusedImports = new Map()
	}
}

// --- 3. FileScanner (Updated to use 'glob' and 'node:fs') ---
class FileScanner {
	#config
	#ignoreFilter = createIgnore()

	constructor(config) {
		this.#config = config
	}

	async init() {
		try {
			const gitignorePath = join(this.#config.FOUNT_DIR, '.gitignore')
			const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8')
			this.#ignoreFilter.add(gitignoreContent)
		} catch (error) {
			if (error.code === 'ENOENT')
				console.warn(chalk.yellow('Warning: .gitignore file not found.'))
			else throw error
		}
	}

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

// --- 4. PathResolver (Updated to use 'node:fs') ---
class PathResolver {
	#config
	constructor(config) { this.#config = config }

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
			const defaultPath = this.#config.PATH_MAPS['/'] || 'src/pages/'
			resolvedPath = join(this.#config.FOUNT_DIR, defaultPath, importPath)
		}
		return this.#normalizeAndCheck(resolvedPath)
	}

	async #normalizeAndCheck(path) {
		const checkExists = async (p) => {
			try {
				const stat = await fs.stat(p)
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

// --- 5. AstParser (Updated to use @babel/parser) ---
class AstParser {
	#config
	#pathResolver

	constructor(config, pathResolver) {
		this.#config = config
		this.#pathResolver = pathResolver
	}

	async parseFile(filepath) {
		try {
			const content = await fs.readFile(filepath, 'utf-8')
			if (filepath.endsWith('.mjs'))
				return await this.#parseMjs(filepath, content)

			if (filepath.endsWith('.html'))
				return await this.#parseHtml(filepath, content)
		} catch (error) {
			console.error(chalk.red(`Error reading or parsing file ${filepath}:`), error)
			return null
		}
	}

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
							const name = spec.local.name
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

// --- 6. DependencyAnalyzer (Updated to use 'glob') ---
class DependencyAnalyzer {
	#config; #allModules
	dependencyGraph = new Map(); usedExports = new Map()
	constructor(config, allModules) { this.#config = config; this.#allModules = allModules }

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

	async #resolveEntryPoints() {
		const entryPointPromises = this.#config.ENTRY_POINTS.map(pattern =>
			glob(pattern, { cwd: this.#config.FOUNT_DIR, absolute: true })
		)
		const allMatches = await Promise.all(entryPointPromises)
		return new Set(allMatches.flat())
	}
}

// --- 7. ReportGenerator (Updated to use 'chalk') ---
class ReportGenerator {
	#config; #allModules; #usedExports; #args
	issueFound = false

	constructor(config, allModules, usedExports, args) {
		this.#config = config; this.#allModules = allModules
		this.#usedExports = usedExports; this.#args = args
	}

	#reportIssue(message) {
		console.log(message)
		this.issueFound = true
	}

	runAllReports() {
		this.reportUnusedExports()
	}

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

// --- Main Execution (Updated to use 'minimist') ---
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
