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
 * 返回综合测试现状库目录。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/state 绝对路径
 */
export function stateDir(repoRoot) {
	return join(testDataRoot(repoRoot), 'state')
}

/**
 * 返回综合测试现状库 JSON 路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/state/main.json
 */
export function stateFilePath(repoRoot) {
	return join(stateDir(repoRoot), 'main.json')
}

/**
 * 返回综合测试现状库 Markdown 路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/state/main.md
 */
export function stateMarkdownPath(repoRoot) {
	return join(stateDir(repoRoot), 'main.md')
}

/**
 * 返回 suite 失败日志绝对路径。
 * @param {string} repoRoot 仓库根
 * @param {string} manifestId manifest id
 * @param {string} suiteName suite 名
 * @returns {string} data/test/state/logs/<manifestId>/<suite>.log
 */
export function stateLogPath(repoRoot, manifestId, suiteName) {
	const safeManifest = manifestId.replace(/[/\\]/g, '_')
	const safeSuite = suiteName.replace(/[/:\\]/g, '_')
	return join(stateDir(repoRoot), 'logs', safeManifest, `${safeSuite}.log`)
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

/**
 * 返回单次运行报告 Markdown 路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/report.md
 */
export function reportMarkdownPath(repoRoot) {
	return join(testDataRoot(repoRoot), 'report.md')
}

/**
 * 返回单次运行报告 JSON 路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/report.json
 */
export function reportJsonPath(repoRoot) {
	return join(testDataRoot(repoRoot), 'report.json')
}

/**
 * 单次运行报告触发原因分离文件名（相对 report.md 同目录）。
 * @type {string}
 */
export const TRIGGERED_REASONS_FILE = 'triggered-reasons.md'

/**
 * 返回单次运行报告触发原因 Markdown 路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/triggered-reasons.md
 */
export function triggeredReasonsMarkdownPath(repoRoot) {
	return join(testDataRoot(repoRoot), TRIGGERED_REASONS_FILE)
}

/**
 * 返回测试节点近 OOM 堆快照目录。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/heapsnapshots 绝对路径
 */
export function heapSnapshotDir(repoRoot) {
	return join(testDataRoot(repoRoot), 'heapsnapshots')
}

/**
 * 返回 Deno panic 上报去重记录路径。
 * @param {string} repoRoot 仓库根
 * @returns {string} data/test/deno_panics.json 绝对路径
 */
export function denoPanicRecordPath(repoRoot) {
	return join(testDataRoot(repoRoot), 'deno_panics.json')
}
