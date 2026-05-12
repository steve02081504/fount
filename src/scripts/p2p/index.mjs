/**
 * 联邦 P2P 共享库入口。生产 DAG/联邦路径在 `shells/chat/src/chat/dag.mjs` 与 `federation.mjs`。
 * 已移除未接线的 `P2PGroupManager` 与 `event_storage` 依赖，避免与 shell DAG 双栈分叉。
 */

export * from './constants.mjs'
export * from './hlc.mjs'
export * from './canonical_json.mjs'
export * from './crypto.mjs'
export * from './dag.mjs'
export * from './permissions.mjs'
export * from './materialized_state.mjs'
export * from './checkpoint.mjs'
export * from './storage_plugins.mjs'
export * from './volatile_streams.mjs'
export * from './owner_succession_ballot.mjs'
/**
 *
 */
export { joinMqttRoom } from './federation_trystero.mjs'
export * from './qr_transfer_protocol.mjs'
