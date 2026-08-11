import { registerIdentityHandlers } from './identity.mjs'
import { registerRelayHandlers } from './relay.mjs'
import { registerRpcHandlers } from './rpc.mjs'
import { registerSyncHandlers } from './sync.mjs'

/**
 * 注册联邦房间全部入站 handler（send 经 wireAction 写入 senderRegistry）。
 * @param {import('./roomContext.mjs').FederationRoomHandlerBundle} bundle 各子域最小依赖
 * @returns {Promise<void>}
 */
export async function attachFederationRoomHandlers(bundle) {
	registerIdentityHandlers(bundle.identity)
	registerRelayHandlers(bundle.relay)
	await registerRpcHandlers(bundle.rpc)
	registerSyncHandlers(bundle.sync)
}
