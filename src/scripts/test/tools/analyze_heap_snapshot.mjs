/**
 * 聚合 V8 .heapsnapshot 中按 type/name 的 self_size，辅助定位测试节点 OOM 泄漏。
 * 用法：deno run --allow-read --v8-flags=--max-old-space-size=12288 analyze_heap_snapshot.mjs <path>
 */
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
	console.error('usage: analyze_heap_snapshot.mjs <path.heapsnapshot>')
	process.exit(2)
}

const raw = readFileSync(path, 'utf8')
const snap = JSON.parse(raw)
const meta = snap.snapshot.meta
const fieldCount = meta.node_fields.length
const typeNames = meta.node_types[0]
const nodes = snap.nodes
const strings = snap.strings

/** @type {Map<string, { count: number, selfSize: number }>} */
const byKey = new Map()

for (let i = 0; i < nodes.length; i += fieldCount) {
	const typeIdx = nodes[i]
	const nameIdx = nodes[i + 1]
	const selfSize = nodes[i + 3] || 0
	const type = typeNames[typeIdx] || `type${typeIdx}`
	const name = typeof nameIdx === 'number' && nameIdx >= 0 ? strings[nameIdx] || '' : ''
	const key = `${type}\t${name.slice(0, 120)}`
	const prev = byKey.get(key) || { count: 0, selfSize: 0 }
	prev.count++
	prev.selfSize += selfSize
	byKey.set(key, prev)
}

const ranked = [...byKey.entries()]
	.sort((a, b) => b[1].selfSize - a[1].selfSize)
	.slice(0, 40)

console.log(`snapshot: ${path}`)
console.log(`nodes: ${nodes.length / fieldCount}`)
console.log('top by self_size (type\\tname\\tcount\\tbytes):')
for (const [key, stats] of ranked) {
	const [type, name] = key.split('\t')
	console.log(`${type}\t${name || '(empty)'}\t${stats.count}\t${stats.selfSize}`)
}
