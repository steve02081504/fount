/**
 * 挖矿结果报告（写入 gitignore 目录）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIM_DIR = path.dirname(fileURLToPath(import.meta.url))

/** gitignore 下的报告输出目录 */
export const RESULTS_DIR = path.join(SIM_DIR, 'results')

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

	await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	await writeFile(mdPath, formatMarkdown(payload), 'utf8')
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

	if (payload.apply?.applied)
		lines.push('## 已应用', '', '最优参数已写回各模块 JSON。', '')
	else if (payload.apply)
		lines.push('## 未应用', '', String(payload.apply.reason || '未达提升门槛'), '')

	if (payload.history?.length) {
		lines.push('## 收敛', '', '| generation | bestFitness | meanFitness |', '| ---: | ---: | ---: |')
		for (const row of payload.history)
			lines.push(`| ${row.generation} | ${fmt(row.bestFitness)} | ${fmt(row.meanFitness)} |`)
		lines.push('')
	}

	if (payload.best?.result?.byScenario) {
		lines.push('## 分场景', '')
		for (const [id, agg] of Object.entries(payload.best.result.byScenario))
			lines.push(`- **${id}**: fitness=${fmt(agg.fitness)}, mean=${fmt(agg.mean)}, min=${fmt(agg.min)}`)
		lines.push('')
	}

	return `${lines.join('\n')}\n`
}

/**
 * @param {number | undefined} n 数值
 * @returns {string} 格式化字符串
 */
function fmt(n) {
	return Number.isFinite(n) ? n.toFixed(4) : '—'
}
