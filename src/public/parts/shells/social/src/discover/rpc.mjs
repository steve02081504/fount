import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { SOCIAL_RPC_REQUEST_TYPES } from '../federation/namespace.mjs'
import { listNoteEvents, NOTE_PULL_BATCH } from '../federation/note_index.mjs'
import { listReactionEvents, normalizeReactionTarget, REACTION_PULL_BATCH } from '../federation/reaction_index.mjs'
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
			const ids = normalizeReactionTarget(rpc.targetEntityHash, rpc.postId)
			if (!ids) 
				return {
					type: 'social_reaction_pull_response',
					targetEntityHash: String(rpc.targetEntityHash || '').toLowerCase(),
					postId: String(rpc.postId || '').trim(),
					events: [],
				}
			
			const afterReactor = rpc.afterReactor
				? String(rpc.afterReactor).trim().toLowerCase()
				: null
			if (afterReactor && !parseEntityHash(afterReactor)) 
				return {
					type: 'social_reaction_pull_response',
					targetEntityHash: ids.target,
					postId: ids.postId,
					events: [],
				}
			
			const events = await listReactionEvents(
				username,
				ids.target,
				ids.postId,
				afterReactor,
				rpc.limit ?? REACTION_PULL_BATCH,
			)
			return {
				type: 'social_reaction_pull_response',
				targetEntityHash: ids.target,
				postId: ids.postId,
				events,
			}
		}
		case 'social_note_pull_request': {
			const target = String(rpc.targetEntityHash || '').toLowerCase()
			const postId = String(rpc.postId || '').trim()
			const afterAuthor = rpc.afterAuthor
				? String(rpc.afterAuthor).trim().toLowerCase()
				: null
			if (!parseEntityHash(target) || (afterAuthor && !parseEntityHash(afterAuthor)))
				return {
					type: 'social_note_pull_response',
					targetEntityHash: target,
					postId,
					events: [],
				}
			const events = await listNoteEvents(
				username,
				target,
				postId,
				afterAuthor,
				rpc.limit ?? NOTE_PULL_BATCH,
			)
			return {
				type: 'social_note_pull_response',
				targetEntityHash: target,
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
		case 'social_post_notify': {
			const { processSocialPostNotifyRpc } = await import('../dispatch.mjs')
			return {
				type: 'social_post_notify_response',
				...await processSocialPostNotifyRpc(username, rpc),
			}
		}
		default:
			return null
	}
}
