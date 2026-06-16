/**
 * 群联邦 Trystero room 预注册的 wire action 名（连接建立时统一 subscribe）。
 */
export const FEDERATION_WIRE_ACTION_NAMES = [
	'identity_announce',
	'fed_pex',
	'fed_partition_bridge',
	'fed_bootstrap_request',
	'fed_bootstrap_response',
	'fed_join_snapshot_request',
	'fed_join_snapshot_response',
	'fed_archive_month_want',
	'fed_archive_month_response',
	'discovery_announce',
	'discovery_query',
	'discovery_query_response',
	'dag_event',
	'gossip_request',
	'gossip_response',
	'channel_history_want',
	'channel_history_response',
	'fed_volatile',
	'fed_tip_ping',
	'fed_tip_pong',
	'char_rpc',
	'char_rpc_response',
	'part_invoke',
]
