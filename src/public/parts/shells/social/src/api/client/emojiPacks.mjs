import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { isAllowedImageUpload, pickUploadedFile } from '../../../../../../../server/web_server/multipart_upload.mjs'
import {
	createEntityPack,
	deleteEntityPack,
	deleteEntityPackEmoji,
	listAvailableEntityPacksForUser,
	listLocalEntityPacks,
	listTimelineEntityPacks,
	loadLocalEntityPack,
	updateEntityPack,
	uploadEntityPackEmoji,
} from '../../emojiPacks.mjs'
import { ensureEntitySocialReady } from '../../lib/bootstrap.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {object} emojiPacks 方法
 */
export function createEmojiPackMethods(apiContext) {
	return {
		emojiPacks: {
			/**
			 * @param {string} [entityHash] 作者；缺省自身
			 * @returns {Promise<object[]>} pack 列表
			 */
			async list(entityHash) {
				const owner = String(entityHash || apiContext.entityHash)
				if (owner === apiContext.entityHash) {
					await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
					return listLocalEntityPacks(apiContext.username, owner)
				}
				const packs = await listTimelineEntityPacks(apiContext.username, owner)
				if (packs.length) return packs
				return listLocalEntityPacks(apiContext.username, owner)
			},

			/**
			 * 观看者可用的全部作者包（自身 + 关注）。
			 * @returns {Promise<object[]>} pack 列表
			 */
			async listAvailable() {
				return listAvailableEntityPacksForUser(apiContext.username, {
					viewerEntityHash: apiContext.entityHash,
				})
			},

			/**
			 * @param {string} entityHash 作者
			 * @param {string} packId pack
			 * @returns {Promise<object>} pack
			 */
			async get(entityHash, packId) {
				const owner = String(entityHash || apiContext.entityHash)
				const pid = packId
				const local = await loadLocalEntityPack(apiContext.username, owner, pid)
				if (local) return local
				const fromTl = (await listTimelineEntityPacks(apiContext.username, owner))
					.find(p => p.packId === pid)
				if (fromTl) return fromTl
				throw httpError(404, 'pack not found')
			},

			/**
			 * @param {object} draft 创建字段
			 * @returns {Promise<object>} 新建 pack
			 */
			async create(draft = {}) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				try {
					return await createEntityPack(apiContext.username, apiContext.entityHash, draft)
				}
				catch (error) {
					throw httpError(error?.message === 'pack already exists' ? 409 : 400, error?.message || 'create failed')
				}
			},

			/**
			 * @param {string} packId pack
			 * @param {object} patch 更新
			 * @returns {Promise<object>} 更新后 pack
			 */
			async update(packId, patch = {}) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				try {
					return await updateEntityPack(apiContext.username, apiContext.entityHash, packId, patch)
				}
				catch (error) {
					throw httpError(error?.message === 'pack not found' ? 404 : 400, error?.message || 'update failed')
				}
			},

			/**
			 * @param {string} packId pack
			 * @returns {Promise<object>} 删除结果
			 */
			async delete(packId) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				const ok = await deleteEntityPack(apiContext.username, apiContext.entityHash, packId)
				if (!ok) throw httpError(404, 'pack not found')
				return { packId, deleted: true }
			},

			/**
			 * @param {string} packId pack
			 * @param {import('npm:express').Request} req multipart 请求
			 * @returns {Promise<object>} 上传结果
			 */
			async uploadEmoji(packId, req) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				const file = pickUploadedFile(req, 'emoji')
				if (!file || !await isAllowedImageUpload(file))
					throw httpError(400, 'invalid emoji image')
				try {
					const item = await uploadEntityPackEmoji(
						apiContext.username,
						apiContext.entityHash,
						packId,
						file.buffer,
						file.originalname,
						file.mimetype,
						req.body?.name,
					)
					return { entry: item }
				}
				catch (error) {
					throw httpError(400, error?.message || 'upload failed')
				}
			},

			/**
			 * @param {string} packId pack
			 * @param {string} emojiId emoji
			 * @returns {Promise<object>} 删除结果
			 */
			async deleteEmoji(packId, emojiId) {
				await ensureEntitySocialReady(apiContext.username, apiContext.entityHash)
				const ok = await deleteEntityPackEmoji(
					apiContext.username,
					apiContext.entityHash,
					packId,
					emojiId,
				)
				if (!ok) throw httpError(404, 'emoji not found')
				return { packId, emojiId, deleted: true }
			},
		},
	}
}
