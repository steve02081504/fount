import {
	deletePendingTipExchange,
	getPendingTipExchange,
	setPendingTipExchange,
} from './registry.mjs'

/** 定向 tip 交换提前收窗后，为迟到 pong 分片保留的宽限毫秒数。 */
const EARLY_SETTLE_GRACE_MS = 150

/**
 * 注册 tip 交换槽、向邻居发 ping，等待 pong 回填远端 DAG 叶 id。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} opts 选项
 * @param {number} opts.waitMs 等待毫秒
 * @param {string} opts.nodeHash 本机 nodeHash
 * @param {string[]} opts.localTips 本地 DAG tips
 * @param {object | undefined} opts.archiveSummary wire archive 摘要
 * @param {(ping: object, peerId: string | null) => void} [opts.sendTipPing] 发送 ping
 * @param {() => Promise<string[]>} opts.pickTargetPeerIds 选取目标 peer
 * @returns {Promise<{ tipIds: Set<string>, remoteSummaries: object[] }>} 收集结果
 */
export async function collectRemoteTipsFromPeers(username, groupId, opts) {
	const prior = getPendingTipExchange(username, groupId)
	if (prior?.resolve) prior.resolve()

	const collected = new Set()
	/** @type {object[]} */
	const remoteSummaries = []

	return new Promise(resolve => {
		let graceTimer = null
		const finish = () => {
			clearTimeout(timer)
			clearTimeout(graceTimer)
			deletePendingTipExchange(username, groupId)
			resolve({ tipIds: collected, remoteSummaries })
		}
		// 已定向到的目标全部回 pong 即可提前收窗（再留一小段宽限收尾迟到分片），无需死等满 waitMs。
		// onResponse 由 pong handler 每次收到 pong 后调用（无论是否携带 archiveSummary）。
		const onResponse = () => {
			pending.responded++
			const expected = pending.expectedPeers
			if (!expected || pending.responded < expected) return
			if (graceTimer) return
			graceTimer = setTimeout(finish, EARLY_SETTLE_GRACE_MS)
		}
		const timer = setTimeout(finish, opts.waitMs)
		const pending = {
			collected,
			remoteSummaries,
			timer,
			resolve: finish,
			onResponse,
			expectedPeers: 0,
			responded: 0,
		}
		setPendingTipExchange(username, groupId, pending)

		void (async () => {
			if (!opts.sendTipPing) return
			const targets = await opts.pickTargetPeerIds()
			// 仅在定向发送（已知目标数）时启用提前收窗；广播（targets 为空、对端数未知）仍走满 waitMs。
			pending.expectedPeers = targets.length
			const ping = {
				nodeHash: opts.nodeHash,
				tips: opts.localTips,
				archiveSummary: opts.archiveSummary,
			}
			if (!targets.length)
				opts.sendTipPing(ping, null)
			else for (const peerId of targets)
				opts.sendTipPing(ping, peerId)
		})().catch(error => console.error('federation: tip ping failed', error))
	})
}
