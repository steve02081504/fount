/** 网络挑战状态机；身份和消息传输由运行时注入。 */
import { randomBytes } from 'node:crypto'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { ms } from '../../scripts/ms.mjs'

const MAX_TIMEOUT = ms('30m')

/**
 * 创建有容量和时限的网络挑战服务，发件者身份来自已认证的网络入口。
 * @param {{nodeHash: string, send: (peer: string, action: string, payload: object) => Promise<boolean>, now?: () => number}} options 依赖项
 * @returns {object} 挑战服务
 */
export function createNetworkVerificationService({ nodeHash, send, now = Date.now }) {
	const requests = new Map()
	const proofs = new Map()
	/**
	 * 清理过期的挑战记录。
	 * @returns {void} 无返回值
	 */
	function prune() {
		for (const [id, entry] of requests) if (entry.expiresAt + 60000 < now()) requests.delete(id)
	}
	/**
	 * 读取挑战的当前状态并处理超时。
	 * @param {object} entry 挑战状态
	 * @returns {object} 状态快照
	 */
	function snapshot(entry) {
		if (entry.status === 'pending' && now() >= entry.expiresAt) entry.status = 'failed', entry.reason = 'timeout'
		return { ...entry }
	}
	return {
		/**
		 * 创建新的随机挑战。
		 * @param {object} root0 选项
		 * @param {number} root0.timeoutMs 超时时间
		 * @returns {object} 挑战记录
		 */
		create({ timeoutMs = 300000 } = {}) {
			if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) throw new Error('invalid timeoutMs')
			prune()
			if (requests.size >= 1024) throw new Error('too many verification requests')
			const challenge = randomBytes(32).toString('hex')
			const entry = { challenge, requesterNodeHash: nodeHash, expiresAt: now() + timeoutMs, status: 'pending' }
			requests.set(challenge, entry)
			return snapshot(entry)
		},
		/**
		 * 按随机挑战码查询进度。
		 * @param {string} challenge 随机挑战码
		 * @returns {object|null} 查询结果
		 */
		get(challenge) {
			prune()
			const entry = requests.get(challenge)
			return entry ? snapshot(entry) : null
		},
		/**
		 * 接收经过 P2P 认证的挑战消息。
		 * @param {string} action 网络动作
		 * @param {object} payload 网络载荷
		 * @param {string} sender 已认证的发件者
		 */
		async receive(action, payload, sender) {
			if (!isHex64(sender) || !isHex64(payload?.challenge)) return
			if (action === 'verification_claim') {
				const entry = requests.get(payload.challenge)
				if (!entry || now() >= entry.expiresAt || snapshot(entry).status === 'failed' || entry.expiresAt !== payload.expiresAt) return
				if (entry.status === 'verified' && entry.nodeHash !== sender) return
				entry.status = 'verified'
				entry.nodeHash = sender
				await send(sender, 'verification_receipt', { challenge: entry.challenge, expiresAt: entry.expiresAt })
			}
			if (action === 'verification_receipt') {
				const proof = proofs.get(payload.challenge)
				if (proof && proof.requesterNodeHash === sender && proof.expiresAt === payload.expiresAt && now() < proof.expiresAt)
					proof.resolve({ status: 'verified', nodeHash })
			}
		},
		/**
		 * 向发起节点证明本机参与其可达网络。
		 * @param {object} root0 选项
		 * @param {string} root0.requesterNodeHash 发起节点身份
		 * @param {string} root0.challenge 随机挑战码
		 * @param {number} root0.expiresAt 截止时间
		 * @returns {Promise<object>} 验证结果
		 */
		async prove({ requesterNodeHash, challenge, expiresAt }) {
			if (!isHex64(requesterNodeHash) || !isHex64(challenge) || !Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + MAX_TIMEOUT)
				return { status: 'failed', reason: 'invalid challenge' }
			if (proofs.has(challenge)) {
				const existing = proofs.get(challenge)
				if (existing.requesterNodeHash !== requesterNodeHash || existing.expiresAt !== expiresAt) return { status: 'failed', reason: 'challenge mismatch' }
				return existing.promise
			}
			if (proofs.size >= 64) return { status: 'failed', reason: 'busy' }
			let resolve
			const promise = new Promise(done => { resolve = done })
			proofs.set(challenge, { requesterNodeHash, expiresAt, resolve, promise })
			const timer = setTimeout(() => resolve({ status: 'failed', reason: 'timeout' }), Math.min(expiresAt - now(), 15000))
			try {
				void send(requesterNodeHash, 'verification_claim', { challenge, expiresAt }).then(sent => {
					if (!sent) resolve({ status: 'failed', reason: 'unreachable' })
				}).catch(() => resolve({ status: 'failed', reason: 'unreachable' }))
				return await promise
			}
			catch { return { status: 'failed', reason: 'unreachable' } }
			finally { clearTimeout(timer); proofs.delete(challenge) }
		},
	}
}
