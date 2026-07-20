/**
 * 聚合 V8 .heapsnapshot 中按 type/name 的 self_size，辅助定位 OOM 泄漏。
 * CLI：deno run --allow-read --allow-write --v8-flags=--max-old-space-size=12288 analyze_heap_snapshot.mjs <path> [--out report.txt] [--top 40] [--needle substr]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

/**
 * @typedef {{ type: string, name: string, count: number, selfSize: number }} HeapNodeRank
 */

/**
 * 解析堆快照并按 self_size 聚合排名。
 * @param {string} snapPath 快照路径
 * @param {{ topN?: number, needle?: string }} [options] 选项
 * @returns {{ snapPath: string, nodeCount: number, ranked: HeapNodeRank[] }} 聚合结果
 */
export function rankHeapSnapshotNodes(snapPath, { topN = 40, needle = '' } = {}) {
	const snap = JSON.parse(readFileSync(snapPath, 'utf8'))
	const meta = snap.snapshot.meta
	const fieldCount = meta.node_fields.length
	const typeNames = meta.node_types[0]
	const nodes = snap.nodes
	const strings = snap.strings
	const typeOffset = meta.node_fields.indexOf('type')
	const nameOffset = meta.node_fields.indexOf('name')
	const selfSizeOffset = meta.node_fields.indexOf('self_size')

	/** @type {Map<string, HeapNodeRank>} */
	const byKey = new Map()

	for (let i = 0; i < nodes.length; i += fieldCount) {
		const typeIdx = nodes[i + typeOffset]
		const nameIdx = nodes[i + nameOffset]
		const selfSize = nodes[i + selfSizeOffset] || 0
		const type = typeNames[typeIdx] || `type${typeIdx}`
		const name = typeof nameIdx === 'number' && nameIdx >= 0 ? strings[nameIdx] || '' : ''
		if (needle && !name.includes(needle)) continue
		const key = `${type}\0${name.slice(0, 160)}`
		const prev = byKey.get(key) ?? { type, name: name.slice(0, 160), count: 0, selfSize: 0 }
		prev.count++
		prev.selfSize += selfSize
		byKey.set(key, prev)
	}

	const ranked = [...byKey.values()]
		.sort((a, b) => b.selfSize - a.selfSize)
		.slice(0, topN)

	return { snapPath, nodeCount: nodes.length / fieldCount, ranked }
}

/**
 * 格式化为可读文本报告。
 * @param {{ snapPath: string, nodeCount: number, ranked: HeapNodeRank[] }} result rank 结果
 * @returns {string} 报告正文
 */
export function formatHeapSnapshotAnalysis(result) {
	const lines = [
		`snapshot: ${result.snapPath}`,
		`nodes: ${result.nodeCount}`,
		'top by self_size (type\\tname\\tcount\\tbytes):',
	]
	for (const row of result.ranked) 
		lines.push(`${row.type}\t${row.name || '(empty)'}\t${row.count}\t${row.selfSize}`)
	
	return `${lines.join('\n')}\n`
}

/**
 * 分析快照并可选写入报告文件。
 * @param {string} snapPath 快照路径
 * @param {{ topN?: number, needle?: string, outPath?: string }} [options] 选项
 * @returns {{ text: string, ranked: HeapNodeRank[] }} 报告文本与排名
 */
export function analyzeHeapSnapshotFile(snapPath, { topN = 40, needle = '', outPath } = {}) {
	const result = rankHeapSnapshotNodes(snapPath, { topN, needle })
	const text = formatHeapSnapshotAnalysis(result)
	if (outPath) writeFileSync(outPath, text)
	return { text, ranked: result.ranked }
}

/**
 * @param {string[]} argv CLI 参数（不含 node/deno）
 * @returns {number} 退出码
 */
export function runHeapSnapshotAnalysisCli(argv) {
	const positional = []
	let outPath
	let topN = 40
	let needle = ''
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--out') { outPath = argv[++i]; continue }
		if (arg === '--top') { topN = Number(argv[++i]); continue }
		if (arg === '--needle') { needle = argv[++i] ?? ''; continue }
		if (!arg.startsWith('--')) positional.push(arg)
	}
	const snapPath = positional[0]
	if (!snapPath) {
		console.error('usage: analyze_heap_snapshot.mjs <path.heapsnapshot> [--out report.txt] [--top 40] [--needle substr]')
		return 2
	}
	if (outPath) {
		analyzeHeapSnapshotFile(snapPath, { topN, needle, outPath })
		console.log(`wrote ${outPath}`)
	}
	else {
		const { text } = analyzeHeapSnapshotFile(snapPath, { topN, needle })
		process.stdout.write(text)
	}
	return 0
}

if (import.meta.main)
	process.exit(runHeapSnapshotAnalysisCli(process.argv.slice(2)))
