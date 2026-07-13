import { collectSocialRpcMerged } from '../federation/part_wire_rpc.mjs'
import { loadViewerContext } from '../feed/helpers.mjs'

import { handleSocialRpc } from './rpc.mjs'

/**
 * 探索页：合并本地 + 邻居 RPC 结果。
 * @param {string} username 用户
 * @param {object} rpc RPC 请求体
 * @param {{ actingEntityHash?: string | null }} [options] acting 观看者
 * @returns {Promise<object>} 合并结果
 */
export async function discoverWithNetwork(username, rpc, options = {}) {
	const local = await handleSocialRpc(username, rpc, {})
	const { data: remote, errors: remoteErrors } = await collectSocialRpcMerged(username, rpc)
	if (remoteErrors.length)
		console.warn('social: neighbor RPC errors', { type: rpc.type, count: remoteErrors.length })
	const merged = { ...local }
	if (rpc.type === 'social_discover_request') {
		const accountMap = new Map((local.accounts || []).map(account => [account.entityHash, account]))
		for (const row of remote)
			for (const account of row.accounts || [])
				accountMap.set(account.entityHash, account)
		const { following } = await loadViewerContext(username, options.actingEntityHash || null)
		merged.accounts = [...accountMap.values()]
			.filter(account => !following.has(String(account.entityHash).toLowerCase()))
			.slice(0, rpc.n || 20)
	}
	if (rpc.type === 'social_post_discover_request') {
		const postMap = new Map((local.posts || []).map(post => [`${post.entityHash}:${post.postId}`, post]))
		for (const row of remote)
			for (const post of row.posts || [])
				postMap.set(`${post.entityHash}:${post.postId}`, post)
		merged.posts = [...postMap.values()].slice(0, rpc.n || 20)
	}
	return merged
}
