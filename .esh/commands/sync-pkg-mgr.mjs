#!/usr/bin/env node
/**
 * 维护工具：将唯一的 POSIX 包管理器函数族同步进全部消费文件。
 *
 * 事实源：`path/fount` 中 `# BEGIN/END FOUNT_PKG_MGR` 之间的**可读** bash 代码块
 * （`path/fount` 经 `run.sh` 用 `/bin/sh` 运行，故必须保持 POSIX）。
 * 消费端（全部注入压缩后的单行内容）：
 * - `README.md` 与 `docs/readme/Readme.*.md`（原样压缩，供任意 shell 复制粘贴）；
 * - `src/runner/npm/main.mjs`（压缩 + JS 转义后注入 `sh_exec` 模板，模板以 `sh` 运行）。
 *
 * `src/runner/main.sh` 是 bash 脚本，不在同步范围——它有自己独立的 bash 版包管理。
 *
 * 用法：`deno run --allow-all .esh/commands/sync-pkg-mgr.mjs` 或 `node .esh/commands/sync-pkg-mgr.mjs`。
 * 测试会校验各消费端与 `path/fount` 的压缩结果一致；不一致时运行本脚本即可。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
/**
 * 标记起始行。
 * @type {string}
 */
export const SH_BEGIN = '# BEGIN FOUNT_PKG_MGR'
/**
 * 标记结束行。
 * @type {string}
 */
export const SH_END = '# END FOUNT_PKG_MGR'

/**
 * 匹配标记块的全局正则（允许空内容块，便于迁移）。
 * @returns {RegExp} 标记块匹配器。
 */
const blockRe = () => new RegExp(`${SH_BEGIN}\\n([\\s\\S]*?)\\n?${SH_END}\\n?`, 'g')

/**
 * 仓库内所有包含安装代码块的 readme。
 * @returns {string[]} 相对仓库根的路径。
 */
export const readmeTargets = () => {
	const dir = join(root, 'docs/readme')
	const names = readdirSync(dir).filter(name => name.startsWith('Readme.') && name.endsWith('.md')).sort()
	return ['README.md', ...names.map(name => `docs/readme/${name}`)]
}

/**
 * 读取事实源代码块（path/fount 中的第一个标记块）。
 * @returns {string} 可读规范原文（末尾带单个换行）。
 */
export function canonicalSource() {
	const fount = readFileSync(join(root, 'path/fount'), 'utf8')
	const m = blockRe().exec(fount)
	if (!m)
		throw new Error('canonical markers missing in path/fount')
	return `${m[1].trimEnd()}\n`
}

/**
 * 规范压缩字节：把事实源压缩为单行，所有消费端以它为准。
 * @returns {string} 单行压缩规范（末尾带单个换行）。
 */
export function canonicalCode() {
	return `${minify(canonicalSource()).trimEnd()}\n`
}

/**
 * 压缩为单行：去掉整行注释与空行，按语句边界以 `; ` 连接。
 * `{`/`do`/`then`/`else`/`in`/`;;` 以及 case 模式 `)` 之后不能直接跟 `;`，改用空格。
 * @param {string} code 规范原文。
 * @returns {string} 单行压缩版。
 */
export function minify(code) {
	const noSepAfter = new Set(['{', 'do', 'then', 'else', 'in', ';;'])
	const lines = code
		.split('\n')
		.map(line => line.replace(/^\s+|\s+$/g, ''))
		.filter(line => line && !line.startsWith('#'))
	let out = ''
	for (let i = 0; i < lines.length; i++) {
		out += lines[i]
		if (i === lines.length - 1) break
		const lastToken = lines[i].split(/\s+/).pop()
		const casePattern = lastToken.endsWith(')') && !lines[i].includes('$(')
		out += noSepAfter.has(lastToken) || casePattern ? ' ' : '; '
	}
	return out
}

/**
 * 转义为可嵌入 JS 模板字符串（模板字面量内 `\`、`` ` `` 与 `${` 需要转义）。
 * @param {string} code 压缩后的 POSIX 代码。
 * @returns {string} JS 转义结果。
 */
export function jsEscape(code) {
	return code
		.replaceAll('\\', '\\\\')
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${')
}

/**
 * 把目标文件里的 FOUNT_PKG_MGR 标记块（全部）替换为指定块；无标记则迁移旧式
 * 单行 `install_package() { ... }` 定义。
 * @param {string} content 目标文件原文。
 * @param {string} block 替换后的标记块。
 * @returns {string} 替换后的内容。
 */
export function injectBlock(content, block) {
	if (content.includes(SH_BEGIN)) 
		return content.replace(blockRe(), () => block)
	
	const migrated = content.replace(/^install_package\(\) \{.*\n/gm, `${block}`)
	if (migrated === content)
		throw new Error('no FOUNT_PKG_MGR markers or legacy install_package definition found')
	return migrated
}

/**
 * 写入单个消费端文件。
 * @param {string} relativePath 相对仓库根路径。
 * @param {string} code 注入的单行规范。
 * @param {boolean} [escaped=false] 是否 JS 转义（mjs 模板用）。
 * @returns {void}
 */
export function writeTarget(relativePath, code, escaped = false) {
	const path = join(root, relativePath)
	const src = readFileSync(path, 'utf8')
	const block = `${SH_BEGIN}\n${escaped ? jsEscape(code) : code}${SH_END}\n`
	writeFileSync(path, injectBlock(src, block))
}

/**
 * 执行同步：把 `path/fount` 的压缩规范写入全部消费端。
 * @returns {void}
 */
export function syncPkgMgr() {
	const canonical = canonicalCode()
	for (const readme of readmeTargets())
		writeTarget(readme, canonical)
	writeTarget('src/runner/npm/main.mjs', canonical, true)
}

if (import.meta.main)
	syncPkgMgr()