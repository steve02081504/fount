import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { applyNetworkHint } from 'npm:@steve02081504/fount-p2p/node/network'
import { getEntityStore } from 'npm:@steve02081504/fount-p2p/node/instance'

import { seedRemoteTimeline } from './federation/remote_timeline.mjs'

/** 前端治理菜单烟测用的固定远程作者种子（32 字节）。 */
export const FOREIGN_FE_SEED = new Uint8Array(Buffer.from('0123456789abcdef'.repeat(4), 'hex'))

const subject = pubKeyHash(publicKeyFromSeed(FOREIGN_FE_SEED))

/** 联邦 ingest 的远程作者 entityHash（与 bootstrap 一致）。 */
export const FOREIGN_FE_AUTHOR_HASH = encodeEntityHash('f'.repeat(64), subject)

/** bootstrap 写入的公开帖正文前缀（Playwright 定位用）。 */
export const FOREIGN_FE_POST_MARKER = 'fe-foreign-governance-post'

/**
 * 为前端测试 ingest 一条远程作者公开帖（供 mute/hide/report 菜单烟测）。
 * @param {string} username 测试 replica 登录名
 * @returns {Promise<{ entityHash: string, postId: string }>} 远程作者实体与帖子 ID
 */
export async function seedForeignFeedAuthorPost(username) {
	applyNetworkHint({
		nodeHash: 'f'.repeat(64),
		source: 'test:foreign-feed-author',
		kind: 'discover',
		weight: 0.2,
	})
	const store = getEntityStore()
	const existing = await store.readEntityJson(FOREIGN_FE_AUTHOR_HASH, 'profile.json')
	if (!existing) 
		await store.writeEntityJson(FOREIGN_FE_AUTHOR_HASH, 'profile.json', {
			entityHash: FOREIGN_FE_AUTHOR_HASH,
			nodeHash: 'f'.repeat(64),
			subjectHash: subject,
			localized: { 'zh-CN': { name: 'Foreign FE Author' } },
			status: 'offline',
			customStatus: '',
			lastSeenAt: 0,
			stats: { joinedAt: Date.now(), messageCount: 0, groupCount: 0, channelCount: 0 },
		})
	

	const [post] = await seedRemoteTimeline(username, FOREIGN_FE_SEED, FOREIGN_FE_AUTHOR_HASH, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{
			type: 'post',
			content: {
				text: `${FOREIGN_FE_POST_MARKER} ${Date.now()}`,
				visibility: 'public',
				lang: 'zh-CN',
			},
		},
	])
	return { entityHash: FOREIGN_FE_AUTHOR_HASH, postId: post.id }
}
