import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { initNode } from 'npm:@steve02081504/fount-p2p/node/instance'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'

import { createFountEntityStore } from '../../public/parts/shells/chat/src/entity/store.mjs'
import { registerP2PInboundHandlers } from './inbound_handlers.mjs'
import { pickPrimaryReplica } from './user_notify.mjs'

/**
 * @param {{ dataPath: string, signaling?: import('npm:@steve02081504/fount-p2p/node/signaling_config').SignalingRuntimeConfig }} options fount 数据根目录
 * @returns {Promise<void>}
 */
export async function initP2PServer({ dataPath, signaling }) {
	const nodeDir = path.join(dataPath, 'p2p', 'node')
	await mkdir(nodeDir, { recursive: true })
	const entityStore = createFountEntityStore()
	initNode({ nodeDir, entityStore, ...signaling ? { signaling } : {} })
	const { createDefaultTrustGraphProvider } = await import('npm:@steve02081504/fount-p2p/trust_graph/registry')
	const { registerTrustGraphProvider } = await import('npm:@steve02081504/fount-p2p/trust_graph/registry')
	registerTrustGraphProvider('default', createDefaultTrustGraphProvider())
	registerP2PInboundHandlers()
	const primary = pickPrimaryReplica()
	// 测试节点也须在启动时先 join user room 并落定，再让联邦 join 群 room（串行 + 落定窗口）。
	// 若跳过启动 join、改在联邦 mid-flight lazy ensureUserRoom，会与已连 peer 的群 room 争抢 offerPool 并断链。
	if (primary)
		await ensureUserRoom({ replicaUsername: primary })
}
