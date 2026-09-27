/**
 * 【文件】src/public/parts/shells/chat/src/reply/wakeScheduler.mjs
 * 【职责】频道×角色唤醒调度：记录槽位是否正在生成、是否收到过未被观察到的唤醒，并据此决定生成结束后是否需要补一次。
 * 【原理】用单调序号代替布尔标记：`mark` 递增全局 `seq` 并记下该键的唤醒序号；生成读取权威日志前用 `snapshot` 取当前序号，
 *   读取完成后 `observe` 记录该键已观察到该序号。`release` 比较唤醒序号与已观察序号，仍更大即说明读取期间到达的唤醒未被看到，返回 `pending`。
 *   这样避免了「读取期间到达的唤醒被布尔标记清除」的竞态。
 * 【数据结构】`seq`、`running: Set<string>`、`wakeSeq: Map<key, number>`、`observedSeq: Map<key, number>`。
 * 【关联】triggerReply（tryBegin/mark/release 补触发）、各 shell 的 `Update({ forRound: true })`（snapshot/observe）、charWake.appendAndWake。
 */

/**
 * 频道×角色唤醒调度器：用单调序号代替布尔标记，避免"读取期间到达的唤醒被清除"的竞态。
 * 键由调用方给出（不透明字符串）。
 * @returns {{
 *   tryBegin(key: string): boolean,
 *   isRunning(key: string): boolean,
 *   mark(key: string): void,
 *   snapshot(): number,
 *   observe(key: string, snapshot: number): void,
 *   release(key: string): boolean,
 *   discard(key: string): void,
 * }} 唤醒调度器接口
 */
export function createWakeScheduler() {
	let seq = 0
	/** @type {Set<string>} */
	const running = new Set()
	/** @type {Map<string, number>} */
	const wakeSeq = new Map()
	/** @type {Map<string, number>} */
	const observedSeq = new Map()

	/**
	 * 尝试开始某键的生成；已在生成中则失败。
	 * @param {string} key 槽位键
	 * @returns {boolean} 是否成功开始
	 */
	function tryBegin(key) {
		if (running.has(key)) return false
		running.add(key)
		return true
	}

	/**
	 * 某键是否正在生成。
	 * @param {string} key 槽位键
	 * @returns {boolean} 是否在生成中
	 */
	function isRunning(key) {
		return running.has(key)
	}

	/**
	 * 记录一次唤醒：递增全局序号并记到该键。
	 * @param {string} key 槽位键
	 * @returns {void}
	 */
	function mark(key) {
		wakeSeq.set(key, ++seq)
	}

	/**
	 * 取当前全局序号，供读取权威日志前调用。
	 * @returns {number} 当前序号
	 */
	function snapshot() {
		return seq
	}

	/**
	 * 记录该键已观察到某序号（取历史最大值，防止旧快照回退）。
	 * @param {string} key 槽位键
	 * @param {number} snapshot 已观察到的序号
	 * @returns {void}
	 */
	function observe(key, snapshot) {
		observedSeq.set(key, Math.max(observedSeq.get(key) ?? 0, snapshot))
	}

	/**
	 * 结束某键的生成并判定是否需要补一次：清除该键全部状态。
	 * @param {string} key 槽位键
	 * @returns {boolean} 是否有未被观察到的唤醒（true = 调用方需补跑一次）
	 */
	function release(key) {
		const pending = (wakeSeq.get(key) ?? 0) > (observedSeq.get(key) ?? 0)
		running.delete(key)
		wakeSeq.delete(key)
		observedSeq.delete(key)
		return pending
	}

	/**
	 * 丢弃某键的全部状态，不作补触发判定。
	 * @param {string} key 槽位键
	 * @returns {void}
	 */
	function discard(key) {
		running.delete(key)
		wakeSeq.delete(key)
		observedSeq.delete(key)
	}

	return { tryBegin, isRunning, mark, snapshot, observe, release, discard }
}
