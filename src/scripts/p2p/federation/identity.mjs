/**
 * 节点级联邦传输配置（node.json）。
 * 用户 operator 身份见 `src/server/p2p_server/operator_identity.mjs`。
 */
export {
	ensureNodeDefaults,
	ensureNodeSeed,
	getNodeHash,
	getNodeTransportSettings,
	saveNodeTransportSettings,
	operatorEntityHashFromKeys,
} from '../node/identity.mjs'
