import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { initNode, setSignalingRuntimeConfig } from 'npm:@steve02081504/fount-p2p/node/instance'
import { ensureUserRoom } from 'npm:@steve02081504/fount-p2p/transport/user_room'
import {
	createDefaultTrustGraphProvider,
	registerTrustGraphProvider,
} from 'npm:@steve02081504/fount-p2p/trust_graph/registry'

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
	initNode({ nodeDir, entityStore })
	if (signaling) setSignalingRuntimeConfig(signaling)
	registerTrustGraphProvider('default', createDefaultTrustGraphProvider())
	registerP2PInboundHandlers()
	const primary = pickPrimaryReplica()
	await ensureUserRoom({
		attachDefaultWires: true,
		...primary ? { replicaUsername: primary } : {},
	})
}
