/**
 * fount 测试运行时数据目录（位于 data/test/，随 /data 一并 gitignore）。
 */
import { join } from 'node:path'

/**
 * 相对仓库根的测试数据根目录。
 * @type {string}
 */
export const TEST_DATA_REL = 'data/test'

/**
 * 返回 data/test 绝对路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test 绝对路径
 */
export function testDataRoot(repoRoot) {
	return join(repoRoot, TEST_DATA_REL)
}

/**
 * 返回失败列表目录路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} 失败列表目录
 */
export function failuresDir(repoRoot) {
	return join(testDataRoot(repoRoot), 'failures')
}

/**
 * 返回指定 manifest 的失败记录 JSON 路径。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @returns {string} 失败记录 JSON 路径
 */
export function failureFilePath(repoRoot, manifestId) {
	const segments = manifestId.split('/')
	return join(failuresDir(repoRoot), ...segments.slice(0, -1), `${segments.at(-1)}.json`)
}

/**
 * 返回 Playwright 产物输出目录。
 * @param {string} repoRoot 仓库根
 * @param {string} [manifestId='default'] manifest id
 * @returns {string} Playwright 产物目录
 */
export function playwrightOutputDir(repoRoot, manifestId = 'default') {
	const safe = manifestId.replace(/[/\\]/g, '_')
	return join(testDataRoot(repoRoot), 'playwright', safe)
}
