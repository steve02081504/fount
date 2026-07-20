/**
 * 【文件】federation/outbound.mjs
 * 【职责】单联邦房间出站优先级队列（§6.4）：合并微任务刷盘发送，拥塞时丢弃低优先级尾部，避免 DAG 被 VOLATILE 淹没。
 * 【原理】createFedOutQueue 按 priority 升序、seq FIFO 插入；queueMicrotask 批量 flush。priority 0=DAG、1=gossip 请求、2=gossip/频道历史应答、3=identity/PEX/tip、10=fed_volatile。超长队列 pop 尾部。
 * 【数据结构】队列项 { priority, seq, run }；FED_OUT_CAP=64。
 * 【关联】room.mjs 构造 FederationSlot 各 send* 方法；与 ws/groupWsBroadcast 的 WS 出站优先级设计对称。
 */
const FED_OUT_CAP = 64

/**
 * 联邦出站优先级队列：priority 越小越先发送。
 * @returns {{ enqueue: (priority: number, run: () => void) => void }} 出站调度器
 */
export function createFedOutQueue() {
	let seq = 0
	/** @type {{ priority: number, seq: number, run: () => void }[]} */
	const queue = []
	let scheduled = false

	/**
	 * 按优先级顺序执行队列中全部出站发送闭包。
	 * @returns {void}
	 */
	function flush() {
		scheduled = false
		while (queue.length) {
			const { run } = queue.shift()
			try {
				run()
			}
			catch (error) {
				console.error('federation: outbound queue send failed', error)
			}
		}
	}

	return {
		/**
		 * @param {number} priority 0 DAG、1 gossip 请求、2 gossip 应答、3 identity/rpc、10 VOLATILE
		 * @param {() => void} run P2P 发送闭包
		 */
		enqueue(priority, run) {
			seq++
			const item = { priority, seq, run }
			let lo = 0
			let hi = queue.length
			while (lo < hi) {
				const middleIndex = (lo + hi) >> 1
				const compare = priority - queue[middleIndex].priority || item.seq - queue[middleIndex].seq
				if (compare < 0) hi = middleIndex
				else lo = middleIndex + 1
			}
			queue.splice(lo, 0, item)
			while (queue.length > FED_OUT_CAP) queue.pop()
			if (!scheduled) {
				scheduled = true
				queueMicrotask(flush)
			}
		},
	}
}

/**
 * 绑定 P2P 原始 send 为 fedOut 优先级出站。
 * @param {{ enqueue: (priority: number, run: () => void) => void }} fedOut 出站队列
 * @param {number} priority 优先级
 * @param {string} label 日志标签
 * @param {Function} sendRaw P2P send
 * @param {() => boolean} [guard] 返回 false 时跳过发送
 * @returns {(payload: unknown, peerId: string | null) => void} 绑定后的发送函数
 */
export function bindFedSender(fedOut, priority, label, sendRaw, guard) {
	return (payload, peerId) => {
		fedOut.enqueue(priority, () => {
			if (guard && !guard()) return
			try {
				sendRaw(payload, peerId)
			}
			catch (error) {
				console.error(`federation: ${label} failed`, error)
			}
		})
	}
}
