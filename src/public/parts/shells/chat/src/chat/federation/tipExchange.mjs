import {
	deletePendingTipExchange,
	setPendingTipExchange,
} from './registry.mjs'

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
	const collected = new Set()
	/** @type {object[]} */
	const remoteSummaries = []

	return new Promise(resolve => {
		/**
		 *
		 */
		const finish = () => {
			clearTimeout(timer)
			deletePendingTipExchange(username, groupId)
			resolve({ tipIds: collected, remoteSummaries })
		}
		const timer = setTimeout(finish, opts.waitMs)
		setPendingTipExchange(username, groupId, {
			collected,
			remoteSummaries,
			timer,
			resolve: finish,
		})

		void (async () => {
			if (!opts.sendTipPing) return
			const targets = await opts.pickTargetPeerIds()
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
