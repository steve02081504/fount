/**
 * Social 入站 post 分发：本机 agent OnMessage + operator care 通知 + 跨节点 post 推送。
 */
import { formatHashShort } from 'fount/public/parts/shells/chat/public/shared/entityHash.mjs'
import { mentionsEntity, extractMentionEntityHashes } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { isCaredBy } from 'fount/public/parts/shells/chat/src/chat/lib/care.mjs'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { loadPart } from '../../../../../server/parts_loader.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { listLocalAgentEntities, resolveSocialEntity } from './federation/hosting.mjs'
import { applyMentionNetworkHint } from './federation/network_hints.mjs'
import { SOCIAL_REP_HIDE_THRESHOLD } from './federation/reputation_social.mjs'
import { withDecryptedPostContent } from './feed/buildItem.mjs'
import { loadViewerContext } from './feed.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { ensureEntitySocialReady } from './lib/bootstrap.mjs'
import { getEntityProfile } from './lib/entityProfile.mjs'
import { mentionSourceText, postTextForNotification } from './lib/postMentionText.mjs'
import { replyViaChat } from './lib/replyViaChat.mjs'

/** @type {Set<string>} (agentHash, postId) 与 care 去重 */
const dispatchedPostKeys = new Set()

/** @type {Map<string, { tokens: number }>} */
const socialReplyBuckets = new Map()

const SOCIAL_THROTTLE_SETTINGS = { enabled: true, burst: 2, refill: 0.5 }

/**
 * @param {string} bucketKey agent 节流键
 * @param {{ enabled: boolean, burst: number, refill: number }} settings 桶配置
 * @returns {{ allowed: boolean }} 是否允许消耗
 */
function consumeSocialReplyToken(bucketKey, settings) {
	if (!settings.enabled) return { allowed: true }
	const row = socialReplyBuckets.get(bucketKey) || { tokens: settings.burst }
	row.tokens = Math.min(settings.burst, row.tokens + settings.refill)
	if (row.tokens < 1) {
		socialReplyBuckets.set(bucketKey, row)
		return { allowed: false }
	}
	row.tokens = Math.max(0, row.tokens - 1)
	socialReplyBuckets.set(bucketKey, row)
	return { allowed: true }
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [replicaUsername] 查询 profile 的 replica
 * @returns {Promise<string>} 展示名或 hash 缩写
 */
async function displayNameForEntity(entityHash, replicaUsername) {
	const profile = replicaUsername ? await getEntityProfile(replicaUsername, entityHash) : null
	return profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 4 })
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
	const { commitTimelineEvent } = await import('./timeline/append.mjs')
	return commitTimelineEvent(username, authorEntityHash, {
		type: 'post',
		charPartName,
		content,
	})
}

/**
 * @param {string} username replica
 * @param {string} authorEntityHash 作者
 * @param {object} post 签名 post
 * @param {string} authorLabel 作者展示名
 * @returns {Promise<void>}
 */
async function dispatchCarePostIfNeeded(username, authorEntityHash, post, authorLabel) {
	const operator = await resolveOperatorEntityHash(username)
	if (!operator) return
	const author = authorEntityHash.toLowerCase()
	if (author === operator) return
	const careKey = `care:${operator}:${post.id}`
	if (dispatchedPostKeys.has(careKey)) return
	if (!await isCaredBy(username, operator, author)) return
	dispatchedPostKeys.add(careKey)
	const snippet = postTextForNotification(post) ?? (authorLabel ? `${authorLabel} 发了新帖` : null)
	const { appendCarePostInboxRow } = await import('./inbox.mjs')
	await appendCarePostInboxRow(username, operator, author, post, snippet)
}

/**
 * @param {string} username replica
 * @param {string} authorEntityHash 作者
 * @param {object} post 签名 post
 * @param {{ entityHashes: string[] }} mentions mention 结构
 * @param {string} authorLabel 作者展示名
 * @param {string} locale 语言/地区
 * @returns {Promise<void>}
 */
async function dispatchLocalAgents(username, authorEntityHash, post, mentions, authorLabel, locale) {
	const author = authorEntityHash.toLowerCase()
	const replyTo = post.content?.replyTo

	for (const { entityHash: agentHash, charPartName } of listLocalAgentEntities(username)) {
		const viewerHash = agentHash.toLowerCase()
		if (viewerHash === author) continue

		const dedupeKey = `agent:${viewerHash}:${post.id}`
		if (dispatchedPostKeys.has(dedupeKey)) continue

		const viewerContext = await loadViewerContext(username, viewerHash)
		if (!canViewPost({ entityHash: author, content: post.content }, viewerContext)) continue

		const decrypted = await withDecryptedPostContent(username, author, post)
		if (!decrypted.content && post.content?.scheme === 'gsh') continue

		dispatchedPostKeys.add(dedupeKey)

		const postText = postTextForNotification({ content: decrypted.content }) ?? ''
		const mentioned = mentionsEntity(mentions, viewerHash)
		if (!mentioned) {
			const { allowed } = consumeSocialReplyToken(`social\0${viewerHash}`, SOCIAL_THROTTLE_SETTINGS)
			if (!allowed) continue
		}

		const char = await loadPart(username, `chars/${charPartName}`)
		if (!char) continue

		const messageEvent = {
			post,
			authorEntityHash: author,
			authorDisplayName: authorLabel,
			postText,
			replyTo,
			mentions,
			viewerEntityHash: viewerHash,
			username,
			charPartName,
			locale,
		}

		const OnMessage = char.interfaces?.social?.OnMessage
		const wantsReply = OnMessage
			? await OnMessage(messageEvent)
			: mentioned
		if (!wantsReply) continue

		const text = await replyViaChat(username, charPartName, char, messageEvent)
		if (!text) continue

		await publishEntityReply(
			username,
			viewerHash,
			{ text, replyTo: replyTo || { entityHash: author, postId: post.id }, visibility: 'public', locale },
			charPartName,
		)
	}
}

/**
 * @param {string} username replica
 * @param {string} authorEntityHash 作者
 * @param {object} post 签名 post
 * @param {string[]} mentionHashes @ 实体列表
 * @returns {Promise<void>}
 */
async function dispatchRemoteMentionPush(username, authorEntityHash, post, mentionHashes) {
	const author = authorEntityHash.toLowerCase()
	const authorRep = pickNodeScore(author.slice(0, 64))
	if (authorRep < SOCIAL_REP_HIDE_THRESHOLD) return

	for (const targetHash of mentionHashes) {
		if (targetHash === author) continue
		applyMentionNetworkHint(username, targetHash)
		const target = await resolveSocialEntity(targetHash)
		if (target?.local && target.kind === 'agent' && target.replicaUsername === username) continue

		const { collectSocialRpcResponses } = await import('./federation/part_wire_rpc.mjs')
		void collectSocialRpcResponses(username, {
			type: 'social_post_notify',
			authorEntityHash: author,
			posterUsername: username,
			post,
		}).catch(err => console.error('social_rpc social_post_notify failed', err))
	}
}

/**
 * 新帖入账分发：本机 agent OnMessage、operator care、跨节点 @ 推送。
 * @param {string} username 入账 replica
 * @param {string} authorEntityHash 作者 entityHash
 * @param {object} post 签名 post
 * @returns {Promise<void>}
 */
export async function dispatchSocialMessage(username, authorEntityHash, post) {
	if (post.type !== 'post') return
	const author = String(authorEntityHash).trim().toLowerCase()
	const mentionHashes = extractMentionEntityHashes(mentionSourceText(post))
	const mentions = { entityHashes: mentionHashes }
	const authorLabel = await displayNameForEntity(author, username)

	await dispatchCarePostIfNeeded(username, author, post, authorLabel)
	await dispatchLocalAgents(username, author, post, mentions, authorLabel, post.content?.locale || 'zh-CN')
	if (mentionHashes.length)
		await dispatchRemoteMentionPush(username, author, post, mentionHashes)
}

/**
 * 联邦 RPC 入站：验签后走同一分发（不落盘；落盘由 timeline pull/ingest）。
 * @param {string} hostingUsername 托管 replica
 * @param {object} rpc RPC 体
 * @returns {Promise<{ ok: boolean }>} RPC 处理结果
 */
export async function processSocialPostNotifyRpc(hostingUsername, rpc) {
	const post = rpc.post
	const authorEntityHash = String(rpc.authorEntityHash || '').trim().toLowerCase()
	if (post?.type !== 'post' || !authorEntityHash) return { ok: false }

	const { readJsonl } = await import('npm:@steve02081504/fount-p2p/dag/storage')
	const { validateRemoteTimelineEvent } = await import('./federation/remote_ingest.mjs')
	const { timelineEventsPath } = await import('./paths.mjs')
	const { canonicalizeSignedTimelineEvent } = await import('./timeline/canonicalizeEvent.mjs')
	const priorEvents = await readJsonl(timelineEventsPath(hostingUsername, authorEntityHash))
	const validated = await validateRemoteTimelineEvent(post, authorEntityHash, {
		canonicalize: canonicalizeSignedTimelineEvent,
		priorEvents,
		username: hostingUsername,
	})
	if (!validated.accepted) return { ok: false }

	await dispatchSocialMessage(rpc.posterUsername || hostingUsername, authorEntityHash, validated.row)
	return { ok: true }
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

	const char = await loadPart(target.replicaUsername, `chars/${target.charPartName}`)
	const handler = char?.interfaces?.social?.OnFollow
	if (!handler) return

	await handler({
		username: target.replicaUsername,
		charPartName: target.charPartName,
		followerEntityHash,
		followerUsername,
		targetEntityHash: target.entityHash,
	})
}

/** @internal 测试用：清空去重集 */
export function resetSocialDispatchDedupForTests() {
	dispatchedPostKeys.clear()
	socialReplyBuckets.clear()
}
