/**
 * Social 事件分发：@ 任意 P2P 实体；本地 agent 经 social OnMention 或 chat.GetReply 回退响应。
 */
import { listLocalAgentEntities, resolveSocialEntity } from './federation/hosting.mjs'
import { formatHashShort } from 'fount/public/pages/scripts/lib/entity_hash.mjs'
import { SOCIAL_REP_HIDE_THRESHOLD } from './federation/reputation_social.mjs'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { listReplicaUsernamesFollowing } from './federation/follower_index.mjs'
import { applyMentionNetworkHint } from './federation/network_hints.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'

import { ensureEntitySocialReady } from './lib/bootstrap.mjs'
import { ensureCharSocialInterface } from './lib/charSocial.mjs'
import { mentionFallbackReplyText } from './lib/chatMentionFallback.mjs'
import { getEntityProfile } from './lib/entityProfile.mjs'
import { extractMentionEntityHashes } from 'fount/public/pages/scripts/lib/mentions.mjs'
import { mentionSourceText, postTextForNotification } from './lib/postMentionText.mjs'
import { commitTimelineEvent } from './timeline/append.mjs'

/**
 * 解析 entityHash 对应的展示名。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [replicaUsername] 查询 profile 的 replica
 * @returns {Promise<string>} 展示名或 hash 缩写
 */
async function displayNameForEntity(entityHash, replicaUsername) {
	const profile = replicaUsername ? await getEntityProfile(replicaUsername, entityHash) : null
	return profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 4 })
}

/**
 * 调用角色 `interfaces.social` 上的指定处理器。
 * @param {string} username replica 登录名
 * @param {string} charPartName chars/ 下目录名
 * @param {string} method interfaces.social 方法名
 * @param {object} event 事件载荷
 * @returns {Promise<{ text?: string, skip?: boolean } | null>} 处理器结果
 */
async function invokeCharSocialInterface(username, charPartName, method, event) {
	const char = await ensureCharSocialInterface(username, charPartName)
	const handler = char?.interfaces?.social?.[method]
	if (!handler) return null
	return normalizeSocialHandlerResult(await handler({
		username,
		charPartName,
		...event,
	}))
}

/**
 * @param {unknown} result social 接口返回值
 * @returns {{ text: string } | { skip: true }} 可发布文本或跳过标记
 */
function normalizeSocialHandlerResult(result) {
	return result?.text ? { text: result.text } : { skip: true }
}

/**
 * 以指定实体身份发布公开回复并联邦 fanout。
 * @param {string} username 代写时间线的 replica 登录名
 * @param {string} authorEntityHash 回复作者 entityHash
 * @param {object} content 帖子 content
 * @param {string | null} [charPartName] 本地 agent 时 chars 目录名
 * @returns {Promise<object>} 签名 post 事件
 */
async function publishEntityReply(username, authorEntityHash, content, charPartName = null) {
	await ensureEntitySocialReady(username, authorEntityHash)
	return commitTimelineEvent(username, authorEntityHash, {
		type: 'post',
		charPartName,
		content,
	})
}

/**
 * 本机托管 agent 对 @ 提及的 OnMention 处理与可选自动回复。
 * @param {ReturnType<typeof resolveSocialEntity>} target 解析后的目标实体
 * @param {object} mentionEvent OnMention 载荷
 * @returns {Promise<{ handled: boolean, published: boolean }>} handled 表示目标是否为本机 agent；published 表示是否已发帖回复
 */
async function handleLocalAgentOnMention(target, mentionEvent) {
	if (!target?.local || target.kind !== 'agent' || !target.replicaUsername || !target.charPartName)
		return { handled: false, published: false }

	const { replicaUsername: username, charPartName, entityHash } = target
	const char = await loadPart(username, `chars/${charPartName}`)
	if (!char) return { handled: true, published: false }

	// OnMention 为正式接口；缺失时回退 chat.GetReply（最小 chatReplyRequest）
	const onMention = char.interfaces?.social?.OnMention
	const text = onMention
		? normalizeSocialHandlerResult(await onMention({
			username,
			charPartName,
			...mentionEvent,
			mentionedEntityHash: entityHash,
		})).text
		: await mentionFallbackReplyText(username, charPartName, char, mentionEvent)
	if (!text) return { handled: true, published: false }

	await publishEntityReply(
		username,
		entityHash,
		{
			text,
			replyTo: mentionEvent.replyTo,
			visibility: 'public',
			lang: mentionEvent.lang,
		},
		charPartName,
	)
	return { handled: true, published: true }
}

/**
 * 本机 replica 上执行 OnMention（供 social_rpc 入站）。
 * @param {string} hostingUsername 托管 replica
 * @param {object} rpc RPC 体
 * @returns {Promise<{ ok: boolean, published?: boolean }>} 处理结果
 */
export async function processSocialOnMentionRpc(hostingUsername, rpc) {
	const target = await resolveSocialEntity(rpc.targetEntityHash, hostingUsername)
	const result = await handleLocalAgentOnMention(target, {
		authorEntityHash: rpc.authorEntityHash,
		authorDisplayName: rpc.authorDisplayName,
		postId: rpc.postId,
		postText: rpc.postText,
		replyTo: rpc.replyTo,
		lang: rpc.lang,
	})
	if (!result.handled) return { ok: false }
	return { ok: true, published: result.published }
}

/**
 * 帖子 @ 提及分发：目标为任意 P2P 实体；本机托管 agent 经 social 接口自动回复。
 * @param {string} posterUsername 发帖 replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {object} post 签名 post
 * @returns {Promise<void>} 无返回值
 */
export async function dispatchPostMentions(posterUsername, authorEntityHash, post) {
	const mentions = extractMentionEntityHashes(mentionSourceText(post))
	if (!mentions.length) return

	const notifyText = postTextForNotification(post)
	const authorLabel = await displayNameForEntity(authorEntityHash, posterUsername)
	const replyTo = { entityHash: authorEntityHash, postId: post.id }
	const lang = post.content?.lang || 'zh-CN'
	const authorRep = pickNodeScore(authorEntityHash.slice(0, 64))

	for (const targetHash of mentions) {
		if (targetHash === authorEntityHash.toLowerCase()) continue
		if (authorRep < SOCIAL_REP_HIDE_THRESHOLD) continue
		applyMentionNetworkHint(posterUsername, targetHash)
		const target = await resolveSocialEntity(targetHash)
		const local = await handleLocalAgentOnMention(target, {
			authorEntityHash,
			authorDisplayName: authorLabel,
			postId: post.id,
			postText: notifyText,
			replyTo,
			lang,
		})
		if (local.handled) continue

		const { collectSocialRpcResponses } = await import('./federation/part_wire_rpc.mjs')
		void collectSocialRpcResponses(posterUsername, {
			type: 'social_on_mention',
			targetEntityHash: targetHash,
			authorEntityHash,
			authorDisplayName: authorLabel,
			postId: post.id,
			postText: notifyText,
			replyTo,
			lang,
		}).catch(err => console.error('social_rpc social_on_mention failed', err))
	}
}

/**
 * 新关注事件：目标为本地 agent 时调用 OnFollow。
 * @param {string} followerUsername 关注者 replica
 * @param {string} followerEntityHash 关注者 entityHash
 * @param {string} targetEntityHash 被关注 entityHash
 * @returns {Promise<void>}
 */
export async function dispatchFollowEvent(followerUsername, followerEntityHash, targetEntityHash) {
	const target = await resolveSocialEntity(targetEntityHash)
	if (!target?.local || target.kind !== 'agent' || !target.replicaUsername || !target.charPartName)
		return

	await invokeCharSocialInterface(
		target.replicaUsername,
		target.charPartName,
		'OnFollow',
		{
			followerEntityHash,
			followerUsername,
			targetEntityHash: target.entityHash,
		},
	)
}

/**
 * 所关注实体发新帖：通知各 replica 上显式实现 OnFollowerUpdate 的本地 agent（无默认实现）。
 * @param {string} authorEntityHash 发帖作者 entityHash
 * @param {object} post 签名 post 事件
 * @returns {Promise<void>}
 */
export async function dispatchPostFollowerUpdates(authorEntityHash, post) {
	const author = String(authorEntityHash || '').toLowerCase()
	if (!author || post?.type !== 'post') return

	const notifyText = postTextForNotification(post)
	const replyTo = { entityHash: author, postId: post.id }
	const lang = post.content?.lang || 'zh-CN'

	for (const viewerUsername of await listReplicaUsernamesFollowing(author))
		for (const { entityHash: agentHash, charPartName } of listLocalAgentEntities(viewerUsername)) {
			const char = await loadPart(viewerUsername, `chars/${charPartName}`)
			const handler = char?.interfaces?.social?.OnFollowerUpdate
			if (typeof handler !== 'function') continue

			const result = await handler({
				username: viewerUsername,
				charPartName,
				authorEntityHash: author,
				postId: post.id,
				postText: notifyText,
				post,
				viewerUsername,
			})
			const custom = normalizeSocialHandlerResult(result)

			if (!custom || custom.skip || !custom.text) continue
			await publishEntityReply(
				viewerUsername,
				agentHash,
				{ text: custom.text, replyTo, visibility: 'public', lang },
				charPartName,
			)
		}

}
