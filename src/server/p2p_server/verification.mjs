import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { sendToNodeLink } from 'npm:@steve02081504/fount-p2p/transport/link_registry'
import { attachNodeScopeFeature } from 'npm:@steve02081504/fount-p2p/transport/node_scope/features'

import { createNetworkVerificationService } from './verification_service.mjs'

let service
/**
 * 为运行中的节点注册验证动作。
 * @returns {() => void} 注销函数
 */
export function attachNetworkVerification() {
	return attachNodeScopeFeature('verification', wire => {
		const current = getNetworkVerificationService()
		const disposers = ['verification_claim', 'verification_receipt'].map(action => wire.on(action, (payload, sender) => {
			void current.receive(action, payload, sender).catch(() => {})
		}))
		return () => { for (const dispose of disposers) dispose(); service = null }
	})
}

/**
 * 获取当前节点的验证服务。
 * @returns {ReturnType<typeof createNetworkVerificationService>} 验证服务
 */
export function getNetworkVerificationService() {
	if (!service) service = createNetworkVerificationService({ nodeHash: getNodeHash(), send: sendVerificationEnvelope })
	return service
}

/**
 * 通过已认证链路发送验证消息；同节点验证在进程内处理。
 * @param {string} peer 目标节点身份
 * @param {string} action 网络动作
 * @param {object} payload 网络载荷
 * @returns {Promise<boolean>} 是否已发送
 */
async function sendVerificationEnvelope(peer, action, payload) {
	if (peer === getNodeHash()) {
		await getNetworkVerificationService().receive(action, payload, peer)
		return true
	}
	return await sendToNodeLink(peer, { scope: 'node', action, payload })
}

/**
 * 证明本节点可到达发起者并收到回执。
 * @param {{requesterNodeHash: string, challenge: string, expiresAt: number}} request 挑战信息
 * @returns {Promise<object>} 验证结果
 */
export async function proveNetworkVerification(request) {
	const dispose = attachNetworkVerification()
	try { return await getNetworkVerificationService().prove(request) }
	finally { dispose() }
}
