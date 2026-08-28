/**
 * 频道消息 source 写操作串行队列。
 * 增量刷新（view-log 拉取）、终稿 patch、删除都可能并发触发并异步写 channelMessagesSource /
 * 虚拟列表。不串行时，先发起的旧快照可能晚于新终稿落盘，把终稿行覆盖回生成中，或与
 * 并发 patch 交错造成重复 DOM 行。这里按触发顺序依次执行，最终状态由「后到者」决定。
 */

/** @type {Promise<void>} 队列尾 */
let tail = Promise.resolve()

/**
 * @param {() => Promise<void> | void} fn 写操作
 * @returns {Promise<void>} 完成时 resolve；前序失败不阻断后续
 */
export function enqueueChannelMutation(fn) {
	const run = tail.then(fn)
	tail = run.catch(() => {})
	return run
}
