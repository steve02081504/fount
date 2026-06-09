import { parseEntityHash } from '../../../../scripts/p2p/entity_id.mjs'
import {
	registerShellPartpath,
	unregisterShellPartpath,
} from '../../../../scripts/p2p/part_path_registry.mjs'
import {
	registerFollowingScanProvider,
	registerReplicaUsernamesProvider,
	unregisterFollowingScanProvider,
	unregisterReplicaUsernamesProvider,
} from '../../../../scripts/p2p/social/follower_index_registry.mjs'
import { getAllUserNames } from '../../../../server/auth.mjs'

import { handleSocialRpc } from './src/discovery.mjs'
import { setEndpoints } from './src/endpoints.mjs'
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
	if (!await ingestRemoteTimelineEvent(username, entityHash, data.event))
		throw new Error('ingest_failed')
	return { result: { ok: true } }
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
	Load: ({ router }) => {
		registerShellPartpath('social', 'shells/social')
		registerReplicaUsernamesProvider(getAllUserNames)
		registerFollowingScanProvider(async username => {
			const { resolveOperatorEntityHash } = await import('../../../../scripts/p2p/entity/replica.mjs')
			const operator = resolveOperatorEntityHash(username)
			if (!operator) return []
			const view = await getTimelineMaterialized(username, operator)
			return view.following
		})
		registerSocialManifestAcl()
		registerSocialManifestTransfer()
		setEndpoints(router)
	},
	/** 卸载 Social shell。 */
	Unload: () => {
		unregisterShellPartpath('social')
		unregisterReplicaUsernamesProvider()
		unregisterFollowingScanProvider()
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
