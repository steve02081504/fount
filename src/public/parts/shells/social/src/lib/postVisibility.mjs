/**
 * 帖子可见性变更：解密 → 改 spec → 重加密 → commit post_visibility_set。
 */
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { maybeDecryptPostContent, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'

import {
	normalizeVisibilitySpec,
	visibilitySpecFromContent,
	visibilitySpecsEqual,
	visibilitySpecToContentFields,
} from './visibilitySpec.mjs'

/**
 * 将帖子可见性改为 targetSpec（若已相同则跳过）。
 * @param {string} username replica
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @param {object | string} targetSpec 目标可见性
 * @returns {Promise<object | null>} 签名事件；跳过则为 null
 */
export async function setPostVisibility(username, entityHash, postId, targetSpec) {
	const owner = String(entityHash).toLowerCase()
	const id = String(postId)
	const view = await getTimelineMaterialized(username, owner)
	const row = view.postById?.[id]
	if (!row) throw httpError(404, 'post not found')

	const plain = await maybeDecryptPostContent(username, owner, row.content, owner)
	if (!plain) throw httpError(500, 'cannot decrypt post for visibility change')

	const nextSpec = normalizeVisibilitySpec(targetSpec)
	const currentSpec = visibilitySpecFromContent(plain)
	if (visibilitySpecsEqual(currentSpec, nextSpec)) return null

	const nextPlain = {
		...plain,
		...visibilitySpecToContentFields(nextSpec),
	}
	// 清掉旧档位字段
	if (nextSpec.visibility !== 'followers_since') delete nextPlain.minFollowMs
	if (nextSpec.visibility !== 'selected') delete nextPlain.allow
	if (!nextSpec.except?.length) delete nextPlain.except

	const encrypted = await maybeEncryptPostContent(username, owner, randomUUID(), nextPlain, nextSpec)
	return commitTimelineEvent(username, owner, {
		type: 'post_visibility_set',
		content: {
			targetPostId: id,
			...visibilitySpecToContentFields(nextSpec),
			content: encrypted,
		},
	})
}
