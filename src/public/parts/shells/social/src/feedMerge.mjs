/**
 * Feed 条目按 HLC 降序比较（与 buildHomeFeed 历史排序一致）。
 * @param {object} left 左侧 feed 条目
 * @param {object} right 右侧 feed 条目
 * @returns {number} 正数表示 left 更新
 */
export function compareFeedItems(left, right) {
	const leftWall = left.hlc.wall
	const rightWall = right.hlc.wall
	if (leftWall !== rightWall) return leftWall - rightWall
	return left.postId.localeCompare(right.postId)
}

/**
 * @param {{ candidates: object[], index: number }} stream 单源流
 * @returns {object | null} 当前队首
 */
function streamHead(stream) {
	if (stream.index >= stream.candidates.length) return null
	return stream.candidates[stream.index]
}

/**
 * @param {{ candidates: object[], index: number }[]} streams 每源已按 compareFeedItems 降序
 * @param {number} streamIndex 流下标
 * @returns {boolean} 该流是否仍有队首
 */
function streamHasHead(streams, streamIndex) {
	return streamIndex >= 0 && streamHead(streams[streamIndex]) != null
}

/**
 * @param {{ candidates: object[], index: number }[]} streams 源流
 * @param {number} leftIndex 左流下标
 * @param {number} rightIndex 右流下标
 * @returns {boolean} left 队首是否新于 right
 */
function streamHeadBeats(streams, leftIndex, rightIndex) {
	return compareFeedItems(streamHead(streams[leftIndex]), streamHead(streams[rightIndex])) > 0
}

/**
 * 多路归并已排序 feed 流用的最大堆（存流下标，按队首 compareFeedItems 降序）。
 */
class FeedStreamMaxHeap {
	/**
	 * @param {{ candidates: object[], index: number }[]} streams 每源已按 compareFeedItems 降序
	 */
	constructor(streams) {
		this.streams = streams
		/** @type {number[]} */
		this.heap = []
		for (let index = 0; index < streams.length; index++)
			if (streamHasHead(streams, index)) this.heap.push(index)
		for (let index = (this.heap.length >> 1) - 1; index >= 0; index--) this.#siftDown(index)
	}

	/**
	 * @returns {number} 当前最优流索引，无则 -1
	 */
	popMax() {
		if (!this.heap.length) return -1
		const best = this.heap[0]
		const last = this.heap.pop()
		if (this.heap.length) {
			this.heap[0] = last
			this.#siftDown(0)
		}
		return best
	}

	/**
	 * 某流前进一位后若仍有队首则重新入堆。
	 * @param {number} streamIndex 流索引
	 * @returns {void}
	 */
	offerStream(streamIndex) {
		if (!streamHasHead(this.streams, streamIndex)) return
		this.heap.push(streamIndex)
		this.#siftUp(this.heap.length - 1)
	}

	/** @param {number} heapIndex 堆下标 */
	#siftUp(heapIndex) {
		const streams = this.streams
		let index = heapIndex
		while (index > 0) {
			const parent = (index - 1) >> 1
			if (!streamHeadBeats(streams, this.heap[index], this.heap[parent])) break
			;[this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]]
			index = parent
		}
	}

	/** @param {number} heapIndex 堆下标 */
	#siftDown(heapIndex) {
		const streams = this.streams
		const heapLength = this.heap.length
		let index = heapIndex
		while (true) {
			const left = index * 2 + 1
			const right = left + 1
			let largest = index
			if (left < heapLength && streamHeadBeats(streams, this.heap[left], this.heap[largest])) largest = left
			if (right < heapLength && streamHeadBeats(streams, this.heap[right], this.heap[largest])) largest = right
			if (largest === index) break
			;[this.heap[index], this.heap[largest]] = [this.heap[largest], this.heap[index]]
			index = largest
		}
	}
}

/**
 * @param {{ candidates: object[], index: number }[]} streams 每源已按 compareFeedItems 降序
 * @returns {number} 下一候选所在流索引，无则 -1
 */
export function pickNextFeedStreamIndex(streams) {
	const heap = new FeedStreamMaxHeap(streams)
	return heap.popMax()
}

/**
 * 多路归并已排序的 feed 候选流，取前 maxCount 条（不含游标偏移）。
 * @param {{ candidates: object[], index: number }[]} streams 每源已按 compareFeedItems 降序
 * @param {number} maxCount 最多条数
 * @returns {object[]} 合并后最多 maxCount 条 feed 条目
 */
export function kWayMergeFeedStreams(streams, maxCount) {
	const heap = new FeedStreamMaxHeap(streams)
	/** @type {object[]} */
	const merged = []
	while (merged.length < maxCount) {
		const best = heap.popMax()
		if (best < 0) break
		merged.push(streams[best].candidates[streams[best].index])
		streams[best].index++
		heap.offerStream(best)
	}
	return merged
}
