import { analyzeHeapSnapshotFile } from '../scripts/test/tools/analyze_heap_snapshot.mjs'

/**
 * fount 堆快照分析工作线程。
 * 在独立 isolate 中聚合 .heapsnapshot 的 top 分配者，避免主进程（可能已接近 OOM）就地 JSON.parse。
 * 协议：主线程 postMessage `{ type: 'analyze', snapshotPath, outPath, topN }`；
 * 完成回 `{ type: 'resolve', data: { text, outPath } }`，失败回 `{ type: 'reject', data: string }`。
 * @param {MessageEvent} e 主线程消息
 * @returns {Promise<void>}
 */
self.onmessage = async e => {
	if (e.data?.type !== 'analyze') return
	const { snapshotPath, outPath, topN } = e.data
	try {
		const { text } = analyzeHeapSnapshotFile(snapshotPath, { topN, outPath })
		self.postMessage({ type: 'resolve', data: { text, outPath } })
	}
	catch (error) {
		self.postMessage({ type: 'reject', data: error?.stack || error?.message || String(error) })
	}
}
