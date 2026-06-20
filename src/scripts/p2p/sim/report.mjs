/**
 * 挖矿结果报告（写入 gitignore 目录）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { snapshotMetricRows } from './metrics.mjs'
import { formatVulnerabilityMarkdown } from './vulnerability.mjs'

const SIM_DIR = path.dirname(fileURLToPath(import.meta.url))

/** gitignore 下的报告输出目录 */
export const RESULTS_DIR = path.join(SIM_DIR, 'results')

/**
 * @param {Array<{ generation: number, bestFitness: number, meanFitness: number }>} history 完整历史
 * @param {number} [maxRows=60] 最大行数
 * @returns {Array<{ generation: number, bestFitness: number, meanFitness: number, note?: string }>} 下采样历史
 */
export function downsampleHistory(history, maxRows = 60) {
	if (!history?.length || history.length <= maxRows) return history ?? []

	/** @type {Array<{ generation: number, bestFitness: number, meanFitness: number, note?: string }>} */
	const out = []
	let lastBest = -Infinity
	const stride = Math.ceil(history.length / maxRows)

	for (let i = 0; i < history.length; i++) {
		const row = history[i]
		const improved = row.bestFitness > lastBest + 1e-6
		const sampled = i % stride === 0 || i === history.length - 1
		if (improved || sampled) {
			out.push({ ...row, note: improved && !sampled ? 'best↑' : undefined })
			if (improved) lastBest = row.bestFitness
		}
	}

	if (out.length && out[0].generation !== history[0].generation)
		out.unshift({ ...history[0] })

	const last = history[history.length - 1]
	if (out[out.length - 1]?.generation !== last.generation)
		out.push({ ...last })

	if (out.length <= maxRows) return out

	const first = out[0]
	const tail = out[out.length - 1]
	const middle = out.slice(1, -1)
	const midStride = Math.max(1, Math.ceil(middle.length / Math.max(1, maxRows - 2)))
	const sampledMiddle = middle.filter((_, i) => i % midStride === 0)
	return [first, ...sampledMiddle, tail].slice(0, maxRows)
}

/**
 * @param {object} payload 报告内容
 * @param {string} [tag] 文件名标签
 * @returns {Promise<{ jsonPath: string, mdPath: string }>} 写入路径
 */
export async function writeReport(payload, tag = 'latest') {
	await mkdir(RESULTS_DIR, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const base = `${tag}-${stamp}`
	const jsonPath = path.join(RESULTS_DIR, `${base}.json`)
	const mdPath = path.join(RESULTS_DIR, `${base}.md`)

	const reportPayload = {
		...payload,
		historyFull: payload.history,
		history: downsampleHistory(payload.history),
	}

	await writeFile(jsonPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8')
	await writeFile(mdPath, formatMarkdown(reportPayload), 'utf8')
	return { jsonPath, mdPath }
}

/**
 * @param {object} payload 报告载荷
 * @returns {string} Markdown 正文
 */
function formatMarkdown(payload) {
	const lines = [
		'# P2P 参数挖矿报告',
		'',
		`生成时间: ${payload.generatedAt || new Date().toISOString()}`,
		'',
	]

	if (payload.durationMs != null) {
		const elapsed = Number(payload.elapsedMs)
		const limit = Number(payload.durationMs)
		lines.push(
			`运行时长: ${Number.isFinite(elapsed) ? (elapsed / 1000).toFixed(1) : '—'}s / ${Number.isFinite(limit) ? (limit / 1000).toFixed(1) : '—'}s`,
			`停止原因: ${payload.stoppedBy || '—'}（完成 ${payload.generationsRun ?? '—'} 代）`,
			'',
		)
	}

	lines.push(
		'## 适应度',
		'',
		'| 指标 | 基线 | 最优 |',
		'| --- | ---: | ---: |',
		`| fitness | ${fmt(payload.baseline?.result?.fitness)} | ${fmt(payload.best?.result?.fitness)} |`,
		`| mean | ${fmt(payload.baseline?.result?.mean)} | ${fmt(payload.best?.result?.mean)} |`,
		`| min | ${fmt(payload.baseline?.result?.min)} | ${fmt(payload.best?.result?.min)} |`,
		'',
	)

	const baselineSnap = payload.baseline?.result?.byScenario
		? Object.values(payload.baseline.result.byScenario)[0]?.snapshots?.[0]
		: null
	const bestSnap = payload.best?.result?.byScenario
		? Object.values(payload.best.result.byScenario)[0]?.snapshots?.[0]
		: null

	if (baselineSnap && bestSnap) {
		lines.push('## 评测维度', '', '| 维度 | 基线 | 最优 |', '| --- | ---: | ---: |')
		for (const row of snapshotMetricRows(baselineSnap, bestSnap))
			lines.push(`| ${row.key} | ${fmt(row.baseline)} | ${fmt(row.best)} |`)
		lines.push('')
	}

	if (payload.apply?.applied)
		lines.push('## 已应用', '', '最优参数已写回各模块 JSON。', '')
	else if (payload.apply)
		lines.push('## 未应用', '', String(payload.apply.reason || '未达提升门槛'), '')

	if (payload.bestRed?.attackGenome) 
		lines.push(
			'## 红队（攻击基因）',
			'',
			'| 指标 | 值 |',
			'| --- | --- |',
			`| 最大伤害 | ${fmt(-(payload.bestRed.result?.fitness ?? 0))} |`,
			`| 名人堂规模 | ${payload.attackHof?.length ?? 0} |`,
			'',
		)
	

	const history = payload.history ?? []
	const historyFull = payload.historyFull ?? history
	if (history.length) {
		const folded = historyFull.length > history.length
			? `（由 ${historyFull.length} 代下采样至 ${history.length} 行）`
			: ''
		lines.push('## 收敛', '', `| generation | bestFitness | meanFitness | note |${folded}`, '| ---: | ---: | ---: | --- |')
		for (const row of history) {
			const note = row.note ?? ''
			lines.push(`| ${row.generation} | ${fmt(row.bestFitness)} | ${fmt(row.meanFitness)} | ${note} |`)
		}
		lines.push('')
	}

	if (payload.best?.result?.byScenario) {
		lines.push('## 分场景', '')
		for (const [id, agg] of Object.entries(payload.best.result.byScenario))
			lines.push(`- **${id}**: fitness=${fmt(agg.fitness)}, mean=${fmt(agg.mean)}, min=${fmt(agg.min)}`)
		lines.push('')
	}

	if (payload.vulnerability)
		lines.push(...formatVulnerabilityMarkdown(payload.vulnerability))

	return `${lines.join('\n')}\n`
}

/**
 * @param {number | undefined} n 数值
 * @returns {string} 格式化字符串
 */
function fmt(n) {
	return Number.isFinite(n) ? n.toFixed(4) : '—'
}
