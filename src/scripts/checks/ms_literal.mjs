/**
 * 手算毫秒乘积检测：Deno 运行时源码里出现 `N * 60 * 1000`、`N * 24 * 60 * 60 * 1000`、
 * `N * 3600 * 1000` 等数值字面量连乘时应改用 `ms('...')`（`src/scripts/ms.mjs`），
 * 避免手算换算错误、便于统一维护。
 * 判定：`*` 连接的数字字面量链，含因子 `1000` 且至少含一个时间单位因子
 * （`60` / `24` / `3600` / `86400` / `7` / `30` / `365`）。
 * 作用域：能 `import ms` 的 Deno 运行时代码（`src/scripts/**`、`src/server/**`、
 * `path/**`、part 的 `src/` 与服务端 `shared/` 等）。浏览器侧（`src/public/pages/`、
 * 各 part 的 `public/`、`.github/pages/`）无法拿到 `src/scripts/ms.mjs` 的服务，不纳入；
 * `*.test.mjs` / `*.spec.mjs` 及 ms 帮助函数本身也不纳入。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listRepoFiles } from './walk.mjs'

/** 扫描的后缀。 */
export const MS_LITERAL_SUFFIXES = ['.mjs', '.js', '.ts']

/** 时间单位换算因子（除 `1000` 外，把一个乘积判定为毫秒的关键因子）。 */
export const MS_TIME_UNIT_FACTORS = new Set(['60', '24', '3600', '86400', '7', '30', '365'])

/** 数字字面量 `*` 连乘链（`g` 标志，供 `matchAll`）。 */
const MS_PRODUCT_CHAIN = /(?<![.\w$])(\d+(?:\s*\*\s*\d+)+)/gu

/**
 * 该路径是否属于能被 ms 帮助函数扫描的 Deno 运行时代码。
 * @param {string} relativePath 相对仓库根
 * @returns {boolean} 应跳过则为 true
 */
export function isMsLiteralScanned(relativePath) {
	if (relativePath === 'src/scripts/ms.mjs'
		|| relativePath === 'src/scripts/checks/ms_literal.mjs')
		return false
	if (/\.(?:test|spec)\.(?:mjs|js|ts)$/u.test(relativePath)) return false
	// 浏览器侧无法 import src/scripts/ms.mjs。
	if (relativePath.startsWith('src/public/pages/')) return false
	if (relativePath.startsWith('.github/pages/')) return false
	if (relativePath.startsWith('src/public/parts/') && relativePath.slice('src/public/parts/'.length).includes('/public/')) return false
	return true
}

/**
 * 判定一条数字字面量连乘链是否为手算毫秒乘积。
 * @param {string} chain `*` 连接的原始文本
 * @returns {boolean} 是毫秒乘积则为 true
 */
function isMsProduct(chain) {
	const factors = chain.split('*').map(factor => factor.trim())
	if (!factors.includes('1000')) return false
	return factors.some(factor => MS_TIME_UNIT_FACTORS.has(factor))
}

/**
 * 计算某个匹配偏移量对应的行号（1 起）。
 * @param {string} content 文件文本
 * @param {number} index 匹配起始偏移
 * @returns {number} 行号
 */
function lineNumberAt(content, index) {
	let line = 1
	for (let offset = 0; offset < index; offset++) if (content[offset] === '\n') line++
	return line
}

/**
 * @typedef {{ path: string, line: number, token: string }} MsLiteralIssue 命中条目
 */

/**
 * 扫描单文件内容中的手算毫秒乘积。
 * @param {string} relativePath 相对仓库根
 * @param {string} content 文件文本
 * @returns {MsLiteralIssue[]} 命中条目
 */
export function scanFileMsLiteral(relativePath, content) {
	/** @type {MsLiteralIssue[]} */
	const issues = []
	for (const match of content.matchAll(MS_PRODUCT_CHAIN)) {
		const chain = match[1]
		if (!isMsProduct(chain)) continue
		issues.push({ path: relativePath, line: lineNumberAt(content, match.index), token: chain })
	}
	return issues
}

/**
 * 扫描仓库 Deno 运行时源码中的手算毫秒乘积（全量）。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<{ files: string[], issues: MsLiteralIssue[] }>} 命中文件与问题列表
 */
export async function scanMsLiteral(repoRoot) {
	/** @type {MsLiteralIssue[]} */
	const issues = []
	for (const relativePath of await listRepoFiles(repoRoot, MS_LITERAL_SUFFIXES)) {
		if (!isMsLiteralScanned(relativePath)) continue
		let content
		try {
			content = await readFile(join(repoRoot, relativePath), 'utf8')
		}
		catch (error) {
			if (error?.code === 'ENOENT') continue
			throw error
		}
		issues.push(...scanFileMsLiteral(relativePath, content))
	}
	return { files: [...new Set(issues.map(issue => issue.path))].sort(), issues }
}
