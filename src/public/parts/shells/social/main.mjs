import { getAgentCharResolver } from 'npm:@steve02081504/fount-p2p/entity/hosting_registry'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import {
	registerShellPartpath,
	unregisterShellPartpath,
} from 'npm:@steve02081504/fount-p2p/registries/part_path'
import {
	registerBlockReputationHandler,
	unregisterBlockReputationHandler,
	mutateReputation,
} from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { getAllUserNames } from '../../../../server/auth/index.mjs'

import { handleSocialRpc } from './src/discover/rpc.mjs'
import { setEndpoints } from './src/endpoints.mjs'
import {
	registerFollowingScanProvider,
	registerOperatorEntityHashProvider,
	registerReplicaUsernamesProvider,
	unregisterFollowingScanProvider,
	unregisterOperatorEntityHashProvider,
	unregisterReplicaUsernamesProvider,
} from './src/federation/follower_index_registry.mjs'
import { applyFollowedBlockSignal } from './src/federation/reputation_social.mjs'
import { registerEntityKeyChainProvider } from './src/federation/write_auth.mjs'
import { registerSocialManifestAcl, unregisterSocialManifestAcl } from './src/manifestAcl.mjs'
import { registerSocialManifestTransfer, unregisterSocialManifestTransfer } from './src/manifestTransfer.mjs'
import { getTimelineMaterialized } from './src/timeline/materialize.mjs'
import { ingestRemoteTimelineEvent } from './src/timeline/sync.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * @param {string} username replica 登录名
 * @param {object} data timeline_put 载荷
 * @returns {Promise<{ ok: boolean }>} ingest 成功
 */
async function handleTimelinePut(username, data) {
	const entityHash = data.timelineEntityHash.toLowerCase()
	if (!parseEntityHash(entityHash)) throw new Error('invalid_timeline_put')
	const ok = await ingestRemoteTimelineEvent(username, entityHash, data.event)
	return { result: { ok } }
}

/**
 * @param {string} username replica 登录名
 * @param {object} data social_rpc 载荷
 * @param {{ requesterNodeHash?: string | null }} ingress 联邦入站元数据
 * @returns {Promise<object>} RPC 响应体
 */
async function handleSocialRpcInvoke(username, data, ingress) {
	const { kind, ...rpc } = data
	const body = await handleSocialRpc(username, rpc, ingress)
	if (!body) throw new Error('unknown_rpc')
	return { result: body }
}

/** @type {Record<string, (username: string, data: object, ingress?: object) => Promise<object>>} */
const p2pInvokeHandlers = {
	timeline_put: handleTimelinePut,
	social_rpc: handleSocialRpcInvoke,
}

/**
 * Social shell：账号 = Chat 联邦 P2P 实体（用户 identity 或本机 agent entityHash），无需单独注册。
 * @type {import('../../../../../src/decl/shellAPI.ts').shellAPI_t}
 */
export default {
	info,
	/**
	 * 加载 Social shell 并注册 HTTP/WS 路由。
	 * @param {object} root0 参数
	 * @param {import('npm:websocket-express').Router} root0.router Express 路由
	 * @returns {void}
	 */
	Load: async ({ router }) => {
		registerShellPartpath('social', 'shells/social')
		registerReplicaUsernamesProvider(getAllUserNames)
		registerOperatorEntityHashProvider(
			(await import('../../../../server/p2p_server/entity_identity.mjs')).resolveOperatorEntityHashForUser,
		)
		registerEntityKeyChainProvider(async username => {
			const { ensureOperatorIdentity } = await import('../../../../server/p2p_server/entity_identity.mjs')
			const row = await ensureOperatorIdentity(username)
			if (!row?.recoveryPubKeyHex) return null
			return {
				recoveryPubKeyHex: String(row.recoveryPubKeyHex).trim().toLowerCase(),
				activePubKeyHex: String(row.activePubKeyHex || '').trim().toLowerCase(),
				entityKeyHistory: Array.isArray(row.keyHistory) ? row.keyHistory : [],
			}
		})
		registerFollowingScanProvider(async username => {
			const { resolveOperatorEntityHashForUser } = await import('../../../../server/p2p_server/entity_identity.mjs')
			const operator = await resolveOperatorEntityHashForUser(username)
			if (!operator) return []
			const view = await getTimelineMaterialized(username, operator)
			return view.following
		})
		registerBlockReputationHandler(opts => applyFollowedBlockSignal(opts, mutateReputation))
		if (!getAgentCharResolver()) {
			const { registerDefaultAgentHosting } = await import('../chat/src/chat/lib/agentHosting.mjs')
			await registerDefaultAgentHosting()
		}
		registerSocialManifestAcl()
		registerSocialManifestTransfer()
		setEndpoints(router)
		const { bootstrapPollDeadlineWatchers } = await import('./src/lib/pollDeadlineWatcher.mjs')
		void bootstrapPollDeadlineWatchers()
	},
	/** 卸载 Social shell。 */
	Unload: () => {
		unregisterShellPartpath('social')
		unregisterOperatorEntityHashProvider()
		unregisterReplicaUsernamesProvider()
		unregisterFollowingScanProvider()
		unregisterBlockReputationHandler()
		unregisterSocialManifestAcl()
		unregisterSocialManifestTransfer()
	},
	interfaces: {
		web: {},
		invokes: {
			/**
			 * P2P part_invoke 入站：timeline put 与 social RPC。
			 * @param {string} username replica 登录名
			 * @param {object} data 入站 invoke 体
			 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站元数据
			 * @returns {Promise<object | null>} 响应体
			 */
			P2PInvokeHandler: async (username, data, ingress = {}) => {
				const handler = p2pInvokeHandlers[data.kind]
				return handler ? handler(username, data, ingress) : null
			},
		},
	},
}
