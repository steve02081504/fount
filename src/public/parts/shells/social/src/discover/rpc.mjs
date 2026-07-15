import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { SOCIAL_RPC_REQUEST_TYPES } from '../federation/namespace.mjs'
import { listReactionEvents, REACTION_PULL_BATCH } from '../federation/reaction_index.mjs'
import { buildFederatedTimelinePullResponse } from '../timeline/sync.mjs'

import { discoverAccounts, discoverFollowGraph, discoverPosts } from './local.mjs'

/**
 * P2P RPC 处理器（供联邦层调用）。
 * @param {string} username 本地用户
 * @param {object} rpc RPC 体
 * @param {{ requesterNodeHash?: string | null }} [ingress] 联邦入站
 * @returns {Promise<object | null>} RPC 响应体
 */
export async function handleSocialRpc(username, rpc, ingress = {}) {
	if (!SOCIAL_RPC_REQUEST_TYPES.has(rpc?.type)) return null
	switch (rpc?.type) {
		case 'social_discover_request': {
			const scoped = ingress.requesterNodeHash
				? { ...rpc, nodeHashPrefix: getNodeHash() }
				: rpc
			return { type: 'social_discover_response', ...await discoverAccounts(username, scoped) }
		}
		case 'social_post_discover_request': {
			const scoped = ingress.requesterNodeHash
				? { ...rpc, nodeHashPrefix: getNodeHash() }
				: rpc
			return { type: 'social_post_discover_response', ...await discoverPosts(username, scoped) }
		}
		case 'social_follow_graph_request':
			return {
				type: 'social_follow_graph_response',
				entityHash: rpc.entityHash,
				following: await discoverFollowGraph(username, String(rpc.entityHash), ingress),
			}
		case 'social_timeline_pull_request': {
			const entityHash = (rpc.entityHash || '').toLowerCase()
			const events = await buildFederatedTimelinePullResponse(
				username,
				entityHash,
				rpc.afterEventId,
				ingress.requesterNodeHash,
			)
			return {
				type: 'social_timeline_pull_response',
				entityHash,
				events,
			}
		}
		case 'social_reaction_pull_request': {
			const targetEntityHash = String(rpc.targetEntityHash || '').toLowerCase()
			const postId = String(rpc.postId || '').trim()
			const events = await listReactionEvents(
				username,
				targetEntityHash,
				postId,
				rpc.afterReactor,
				rpc.limit ?? REACTION_PULL_BATCH,
			)
			return {
				type: 'social_reaction_pull_response',
				targetEntityHash,
				postId,
				events,
			}
		}
		case 'social_tag_merge_claim': {
			const { ingestTagMergeClaim } = await import('../taste/mergeClaims.mjs')
			return {
				type: 'social_tag_merge_claim_response',
				...await ingestTagMergeClaim(username, rpc.claim, ingress),
			}
		}
		case 'social_tag_name_claim': {
			const { ingestTagNameClaim } = await import('../taste/nameClaims.mjs')
			return {
				type: 'social_tag_name_claim_response',
				...await ingestTagNameClaim(username, rpc.claim, ingress),
			}
		}
		case 'social_post_notify': {
			const { processSocialPostNotifyRpc } = await import('../dispatch.mjs')
			return {
				type: 'social_post_notify_response',
				...await processSocialPostNotifyRpc(username, rpc),
			}
		}
		case 'social_report': {
			const { ingestInboundReport } = await import('../governance/report.mjs')
			const ok = await ingestInboundReport(username, rpc.report)
			return { type: 'social_report_response', ok }
		}
		default:
			return null
	}
}
