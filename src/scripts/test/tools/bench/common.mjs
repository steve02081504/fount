/**
 * fount test 性能基准共享工具：统计量、表格渲染、迭代跑批。
 *
 * 四个基准工具（kernel_startup / kernel_link / test_cycle / viewer_cycle）共用此模块，
 * 统一输出 markdown 表格便于人工对比优化前后。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 一组数值样本的统计量。
 * @typedef {object} Stats
 * @property {number} min 最小值
 * @property {number} p25 第 25 百分位
 * @property {number} median 中位数
 * @property {number} mean 算术均值
 * @property {number} p75 第 75 百分位
 * @property {number} max 最大值
 * @property {number} n 样本数
 */

/**
 * 计算一组数值的统计量。
 * @param {number[]} values 样本
 * @returns {Stats} 统计量（空数组返回全 0）
 */
export function stats(values) {
	const sorted = [...values].sort((a, b) => a - b)
	const n = sorted.length
	if (!n)
		return { min: 0, p25: 0, median: 0, mean: 0, p75: 0, max: 0, n }
	/**
	 * 取排序样本的百分位值。
	 * @param {number} p 百分位（0–100）
	 * @returns {number} 对应样本值
	 */
	const percentile = p => sorted[Math.min(n - 1, Math.max(0, Math.round((p / 100) * (n - 1))))]
	const sum = sorted.reduce((a, b) => a + b, 0)
	return {
		min: sorted[0],
		p25: percentile(25),
		median: percentile(50),
		mean: sum / n,
		p75: percentile(75),
		max: sorted[n - 1],
		n,
	}
}

/**
 * 单值统计行。
 * @param {number[]} values 样本
 * @returns {string} `min / median / max` 渲染
 */
export function row(values) {
	const s = stats(values)
	return `${fmt(s.min)} / ${fmt(s.median)} / ${fmt(s.max)}`
}

/**
 * 格式化毫秒（保留一位小数）。
 * @param {number} ms 毫秒
 * @returns {string} 格式化结果
 */
export function fmt(ms) {
	return Number.isFinite(ms) ? `${ms.toFixed(1)}` : '—'
}

/**
 * 渲染一组「总时长 + 相位拆分」的 markdown 表格。
 * @param {string} title 标题
 * @param {{ name: string, samples: number[] }[]} rows 行：name + 每次迭代的时长样本
 * @returns {string} markdown 表格
 */
export function renderTable(title, rows) {
	const lines = [`### ${title}`]
	lines.push('| 相位 | min | 中位 | max | 样本 |')
	lines.push('| --- | --- | --- | --- | --- |')
	for (const { name, samples } of rows)
		lines.push(`| ${name} | ${fmt(stats(samples).min)} | ${fmt(stats(samples).median)} | ${fmt(stats(samples).max)} | ${samples.length} |`)
	return lines.join('\n')
}

/**
 * 创建一次迭代专用的临时目录，并确保结束时清理。
 * @param {string} prefix 临时目录前缀（`fount-bench-*`）
 * @param {(dir: string) => Promise<void>} run 迭代体
 * @returns {Promise<void>} 无返回值
 */
export async function withTempDir(prefix, run) {
	const dir = await mkdtemp(join(tmpdir(), prefix))
	try {
		await run(dir)
	}
	finally {
		const { rm } = await import('node:fs/promises')
		await rm(dir, { recursive: true, force: true }).catch(() => { })
	}
}