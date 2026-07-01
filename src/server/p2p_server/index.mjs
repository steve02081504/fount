import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
	registerEntityPresentationProvider,
	registerLocalesFromRequestProvider,
} from '../../scripts/p2p/entity/presentation_registry.mjs'
import { initNode } from '../../scripts/p2p/node/instance.mjs'
import { ensureUserRoom } from '../../scripts/p2p/user_room.mjs'

import { createFountEntityStore } from './entity_store.mjs'
import { registerP2PInboundHandlers } from './inbound_handlers.mjs'
import { getInfoDefaultsForEntity, localesFromRequest } from './presentation.mjs'
import { pickPrimaryReplica } from './user_notify.mjs'

/**
 * @param {{ dataPath: string }} options fount 数据根目录
 * @returns {Promise<void>}
 */
export async function initP2PServer({ dataPath }) {
	const nodeDir = path.join(dataPath, 'p2p', 'node')
	await mkdir(nodeDir, { recursive: true })
	const entityStore = createFountEntityStore()
	initNode({ nodeDir, entityStore })
	registerEntityPresentationProvider(getInfoDefaultsForEntity)
	registerLocalesFromRequestProvider(localesFromRequest)
	registerP2PInboundHandlers()
	const primary = pickPrimaryReplica()
	// 测试节点也须在启动时先 join user room 并落定，再让联邦 join 群 room（串行 + 落定窗口）。
	// 若跳过启动 join、改在联邦 mid-flight lazy ensureUserRoom，会与已连 peer 的群 room 争抢 offerPool 并断链。
	if (primary)
		await ensureUserRoom({ replicaUsername: primary })
}
