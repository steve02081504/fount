/**
 * 联邦房间 handler 依赖：按子域拆分 typedef + 构造期 pick，避免 handler 接触无关可变状态。
 */

/**
 * @typedef {object} FederationWireBinding
 * @property {ReturnType<import('../../../../../../../../scripts/p2p/trystero_session.mjs').createTrysteroActionRegistry>} wireActions
 * @property {Map<string, Function>} senderRegistry
 */

/**
 * @typedef {FederationWireBinding & {
 *   username: string,
 *   groupId: string,
 *   room: object,
 *   getActionSender: (name: string) => Function,
 *   getActionReceiver: (name: string) => Function,
 * }} FederationRoomWireContext
 */

/**
 * @typedef {FederationRoomWireContext & {
 *   nodeHash: string,
 *   fedOut: object,
 *   peerToNode: Map<string, string>,
 *   isBlockedPeer: (subject: string) => boolean,
 * }} FederationRelayContext
 */

/**
 * @typedef {FederationRoomWireContext & {
 *   key: string,
 *   nodeHash: string,
 *   groupSettings: object,
 *   fedOut: object,
 *   rtcLimits: object,
 *   peerToNode: Map<string, string>,
 *   nodeToPeer: Map<string, string>,
 *   ensureFederationPartitionRoom: Function,
 *   getSlot: () => import('../federationSlot.mjs').FederationSlot | null,
 * }} FederationIdentityContext
 */

/**
 * @typedef {FederationRoomWireContext & {
 *   nodeHash: string,
 *   groupSettings: object,
 *   fedOut: object,
 *   peerToNode: Map<string, string>,
 *   isBlockedPeer: (subject: string) => boolean,
 * }} FederationSyncContext
 */

/**
 * @typedef {FederationRoomWireContext & {
 *   key: string,
 *   fedOut: object,
 *   rtcLimits: object,
 * }} FederationRpcContext
 */

/**
 * @typedef {object} FederationRoomHandlerBundle
 * @property {FederationIdentityContext} identity
 * @property {FederationRelayContext} relay
 * @property {FederationSyncContext} sync
 * @property {FederationRpcContext} rpc
 */

/**
 * @param {FederationRoomWireContext} wireContext 房间 join 期 wire 绑定
 * @returns {FederationRoomWireContext} Trystero wire 最小子集
 */
export function pickWireContext(wireContext) {
	return {
		username: wireContext.username,
		groupId: wireContext.groupId,
		room: wireContext.room,
		wireActions: wireContext.wireActions,
		senderRegistry: wireContext.senderRegistry,
		getActionSender: wireContext.getActionSender,
		getActionReceiver: wireContext.getActionReceiver,
	}
}

/**
 * @param {FederationIdentityContext} identityContext 完整 identity 依赖
 * @returns {FederationIdentityContext} identity handler 依赖
 */
export function pickIdentityContext(identityContext) {
	return {
		...pickWireContext(identityContext),
		key: identityContext.key,
		nodeHash: identityContext.nodeHash,
		groupSettings: identityContext.groupSettings,
		fedOut: identityContext.fedOut,
		rtcLimits: identityContext.rtcLimits,
		peerToNode: identityContext.peerToNode,
		nodeToPeer: identityContext.nodeToPeer,
		ensureFederationPartitionRoom: identityContext.ensureFederationPartitionRoom,
		getSlot: identityContext.getSlot,
	}
}

/**
 * @param {FederationRelayContext} relayContext 完整 relay 依赖
 * @returns {FederationRelayContext} relay handler 依赖
 */
export function pickRelayContext(relayContext) {
	return {
		...pickWireContext(relayContext),
		nodeHash: relayContext.nodeHash,
		fedOut: relayContext.fedOut,
		peerToNode: relayContext.peerToNode,
		isBlockedPeer: relayContext.isBlockedPeer,
	}
}

/**
 * @param {FederationSyncContext} syncContext 完整 sync 依赖
 * @returns {FederationSyncContext} sync handler 依赖
 */
export function pickSyncContext(syncContext) {
	return {
		...pickWireContext(syncContext),
		nodeHash: syncContext.nodeHash,
		groupSettings: syncContext.groupSettings,
		fedOut: syncContext.fedOut,
		peerToNode: syncContext.peerToNode,
		isBlockedPeer: syncContext.isBlockedPeer,
	}
}

/**
 * @param {FederationRpcContext} rpcContext 完整 rpc 依赖
 * @returns {FederationRpcContext} rpc handler 依赖
 */
export function pickRpcContext(rpcContext) {
	return {
		...pickWireContext(rpcContext),
		key: rpcContext.key,
		fedOut: rpcContext.fedOut,
		rtcLimits: rpcContext.rtcLimits,
	}
}

/**
 * @param {FederationIdentityContext & FederationRelayContext & FederationSyncContext & FederationRpcContext} params join 期全量依赖
 * @returns {FederationRoomHandlerBundle} 各 handler 最小依赖包
 */
export function createFederationRoomHandlerBundle(params) {
	return {
		identity: pickIdentityContext(params),
		relay: pickRelayContext(params),
		sync: pickSyncContext(params),
		rpc: pickRpcContext(params),
	}
}
