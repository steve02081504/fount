/**
 * 测试内核待运行队列：CLI 同优先级 LIFO、FS LIFO、预备 debounce。
 */
import { ms } from '../../ms.mjs'

/** 预备队列默认静置时长（毫秒）。 */
export const DEFAULT_PREP_SETTLE_MS = ms('3m')

/**
 * 队列项。
 * @typedef {object} QueueItem
 * @property {string} id 项 id
 * @property {string} key suite 键
 * @property {'cli' | 'fs'} source 来源
 * @property {string} [viewerId] 所属 viewer（CLI）
 * @property {string} [jobId] 所属 job（CLI）
 * @property {boolean} [force] 是否强制真跑
 * @property {string[]} [subtests] 子测试过滤
 * @property {string} [reason] 入队原因
 * @property {number} [priority] 越小越先（同就绪时 imperfect 优先）
 * @property {number} enqueuedAt 入队时间
 */

/**
 * 预备项。
 * @typedef {object} PrepEntry
 * @property {string} key suite 键
 * @property {number} lastHit 最近命中时间
 * @property {string} [reason] 命中原因
 */

/**
 * CLI 同优先级 LIFO + FS LIFO + 预备 debounce。
 */
export class TestQueues {
	/**
	 * @param {object} [options] 选项
	 * @param {number} [options.prepSettleMs] 预备静置
	 * @param {() => number} [options.now] 当前时间
	 */
	constructor({ prepSettleMs = DEFAULT_PREP_SETTLE_MS, now = () => Date.now() } = {}) {
		this.prepSettleMs = prepSettleMs
		this.now = now
		/** @type {QueueItem[]} */
		this.cli = []
		/** @type {QueueItem[]} */
		this.fs = []
		/** @type {Map<string, PrepEntry>} */
		this.prep = new Map()
		this.#seq = 0
	}

	#seq

	/**
	 * @returns {string} 新项 id
	 */
	#nextId() {
		this.#seq += 1
		return `q${this.#seq}`
	}

	/**
	 * CLI 队列追加（尾部；同优先级由 peekReady 取最后入队者）。
	 * @param {Omit<QueueItem, 'id' | 'source' | 'enqueuedAt'>} spec 项
	 * @returns {QueueItem} 入队项
	 */
	enqueueCli(spec) {
		const item = {
			...spec,
			id: this.#nextId(),
			source: 'cli',
			enqueuedAt: this.now(),
		}
		this.cli.push(item)
		return item
	}

	/**
	 * 文件变更命中：写入/刷新预备；若已在 FS 队列则拿回预备。
	 * @param {string} key suite 键
	 * @param {string} [reason] 原因
	 * @returns {void}
	 */
	hitPrep(key, reason = 'fs_change') {
		this.fs = this.fs.filter(item => item.key !== key)
		this.prep.set(key, { key, lastHit: this.now(), reason })
	}

	/**
	 * 直接入 FS 队头（不经预备 debounce；idle-all 等即时触发用）。
	 * @param {string} key suite 键
	 * @param {string} [reason] 原因
	 * @returns {QueueItem} 入队项
	 */
	enqueueFs(key, reason = 'fs_change') {
		this.prep.delete(key)
		this.fs = this.fs.filter(item => item.key !== key)
		const item = {
			id: this.#nextId(),
			key,
			source: 'fs',
			reason,
			enqueuedAt: this.now(),
		}
		this.fs.unshift(item)
		return item
	}

	/**
	 * 预备静置到期 → FS 队头（LIFO）。
	 * @returns {QueueItem[]} 新晋升项
	 */
	promotePrep() {
		const now = this.now()
		/** @type {QueueItem[]} */
		const promoted = []
		for (const [key, entry] of this.prep) {
			if (now - entry.lastHit < this.prepSettleMs) continue
			this.prep.delete(key)
			const item = {
				id: this.#nextId(),
				key,
				source: 'fs',
				reason: entry.reason,
				enqueuedAt: now,
			}
			this.fs.unshift(item)
			promoted.push(item)
		}
		return promoted
	}

	/**
	 * 距下次预备晋升的等待（无则 null）。
	 * @returns {number | null} 毫秒
	 */
	nextPrepWaitMs() {
		if (!this.prep.size) return null
		const now = this.now()
		let min = Infinity
		for (const entry of this.prep.values()) {
			const wait = this.prepSettleMs - (now - entry.lastHit)
			if (wait < min) min = wait
		}
		return min <= 0 ? 0 : min
	}

	/**
	 * 取下一个可调度项：CLI 同优先级后入队者先（LIFO），否则 FS 中最新的 ready。不做出队。
	 * @param {(item: QueueItem) => boolean} isReady 是否可开工
	 * @returns {{ queue: 'cli' | 'fs', item: QueueItem } | null} 选中项
	 */
	peekReady(isReady) {
		let best
		let bestPriority = Infinity
		for (const item of this.cli) {
			if (!isReady(item)) continue
			const priority = item.priority ?? 1
			if (priority < bestPriority) {
				bestPriority = priority
				best = item
			}
			else if (priority === bestPriority)
				best = item
		}
		if (best)
			return { queue: 'cli', item: best }
		const item = this.fs.find(isReady)
		if (item)
			return { queue: 'fs', item }
		return null
	}

	/**
	 * 按项身份出队 peekReady 的结果；项已不在队列则无返回。
	 * @param {{ queue: 'cli' | 'fs', item: QueueItem }} picked peek 结果
	 * @returns {QueueItem | undefined} 出队项
	 */
	dequeue(picked) {
		const list = picked.queue === 'cli' ? this.cli : this.fs
		const index = list.indexOf(picked.item)
		if (index < 0) return undefined
		return list.splice(index, 1)[0]
	}

	/**
	 * 列出某 viewer 的 CLI 项并移除。
	 * @param {string} viewerId viewer
	 * @returns {QueueItem[]} 被移出的项
	 */
	removeViewer(viewerId) {
		const kept = []
		const removed = []
		for (const item of this.cli)
			(item.viewerId === viewerId ? removed : kept).push(item)
		this.cli = kept
		return removed
	}

	/**
	 * CLI 项完成：去掉 FS 队列中相同 key。
	 * @param {string} key suite 键
	 * @returns {QueueItem[]} 被移出的 FS 项
	 */
	completeCli(key) {
		const removed = this.fs.filter(item => item.key === key)
		this.fs = this.fs.filter(item => item.key !== key)
		this.prep.delete(key)
		return removed
	}

	/**
	 * 按 key 移出预备 / CLI / FS（manifest 消失等）。
	 * @param {string} key suite 键
	 * @returns {QueueItem[]} 被移出的待运行项（不含预备）
	 */
	removeKey(key) {
		const removed = [
			...this.cli.filter(item => item.key === key),
			...this.fs.filter(item => item.key === key),
		]
		this.cli = this.cli.filter(item => item.key !== key)
		this.fs = this.fs.filter(item => item.key !== key)
		this.prep.delete(key)
		return removed
	}

	/**
	 * 移出全部预备与待运行项（内核关闭）。
	 * @returns {QueueItem[]} 待运行项
	 */
	drain() {
		const queued = [...this.cli, ...this.fs]
		this.cli = []
		this.fs = []
		this.prep.clear()
		return queued
	}

	/**
	 * 双待运行队列是否空（不含预备）。
	 * @returns {boolean} 是否空
	 */
	pendingEmpty() {
		return this.cli.length === 0 && this.fs.length === 0
	}

	/**
	 * 预备 + 双队列都空。
	 * @returns {boolean} 是否全空
	 */
	allEmpty() {
		return this.pendingEmpty() && this.prep.size === 0
	}
}
