import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { isNodeInitialized } from 'npm:@steve02081504/fount-p2p/node/instance'
import { getLinkRegistry } from 'npm:@steve02081504/fount-p2p/transport/link_registry'

import { config, save_config } from './server.mjs'

/**
 * 读取节点邀请状态；旧配置没有邀请字段，视为迁移前已启用的节点。
 * @returns {{ invited: boolean, invitedByNodeHash: string | null, nodeHash: string }} 状态
 */
export function invitationStatus() {
	const invitedByNodeHash = config?.invitedByNodeHash
	return {
		invited: invitedByNodeHash !== null,
		invitedByNodeHash: invitedByNodeHash || null,
		nodeHash: getNodeHash(),
	}
}

/**
 * 接受邀请并持久化邀请节点。
 * @param {string} nodeHash 邀请节点身份
 * @returns {ReturnType<typeof invitationStatus>} 更新后的状态
 */
export function acceptInvitation(nodeHash) {
	if (!/^[\da-f]{64}$/iu.test(nodeHash)) throw new Error('invalid inviter node hash')
	config.invitedByNodeHash = nodeHash.toLowerCase()
	save_config()
	return invitationStatus()
}

/**
 * 判断当前是否至少存在一条活跃的 fount P2P 链路。
 * @returns {boolean} 是否有链路
 */
export function hasFountNetworkLink() {
	if (!isNodeInitialized()) return false
	try { return getLinkRegistry().listLinks().length > 0 }
	catch { return false }
}
