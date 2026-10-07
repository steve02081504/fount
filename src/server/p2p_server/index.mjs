import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { initNode, setSignalingRuntimeConfig } from 'npm:@steve02081504/fount-p2p/node/instance'
import { configureLinkRegistry, getLinkRegistry } from 'npm:@steve02081504/fount-p2p/transport/link_registry'
import { createPeerHealthTracker } from 'npm:@steve02081504/fount-p2p/transport/peer_health'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'
import {
	createDefaultTrustGraphProvider,
	registerTrustGraphProvider,
} from 'npm:@steve02081504/fount-p2p/trust_graph/registry'

import { createFountEntityStore } from '../../public/parts/shells/chat/src/entity/store.mjs'

import { normalizeNodeIceServers } from './ice_servers.mjs'
import { registerP2PInboundHandlers } from './inbound_handlers.mjs'
import { pickPrimaryReplica } from './user_notify.mjs'
import { attachNetworkVerification } from './verification.mjs'

/** @type {ReturnType<typeof createPeerHealthTracker> | null} 节点级邻居健康追踪器。 */
let peerHealthTracker = null

/**
 * 获取节点级邻居健康追踪器（常态链路维护中实测的 RTT / 联通状态）。
 * @returns {ReturnType<typeof createPeerHealthTracker> | null} 追踪器；P2P 未初始化时为 null。
 */
export function getPeerHealthTracker() {
	return peerHealthTracker
}

/**
 * @param {{ dataPath: string, signaling?: import('npm:@steve02081504/fount-p2p/node/signaling_config').SignalingRuntimeConfig, iceServers?: unknown }} options fount 数据根目录、信令与本地 ICE/TURN 配置
 * @returns {Promise<void>}
 */
export async function initP2PServer({ dataPath, signaling, iceServers }) {
	const nodeDir = path.join(dataPath, 'p2p', 'node')
	await mkdir(nodeDir, { recursive: true })
	// 必须在 initNode / getLinkRegistry 之前：registry 一旦创建就再也不能配置了。
	configureLinkRegistry({ iceServers: normalizeNodeIceServers(iceServers) })
	const entityStore = createFountEntityStore()
	initNode({ nodeDir, entityStore })
	attachNetworkVerification()
	peerHealthTracker = createPeerHealthTracker(getLinkRegistry())
	if (signaling) setSignalingRuntimeConfig(signaling)
	registerTrustGraphProvider('default', createDefaultTrustGraphProvider())
	registerP2PInboundHandlers()
	const primary = pickPrimaryReplica()
	await ensureUserRoom({
		attachDefaultWires: true,
		...primary ? { replicaUsername: primary } : {},
	})
}
