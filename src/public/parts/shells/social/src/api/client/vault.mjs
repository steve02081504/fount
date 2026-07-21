import { getVaultFileByShareId, registerVaultFile } from '../../socialVaultIndex.mjs'
import { commitTimelineEvent } from '../../timeline/append.mjs'

/**
 * @param {import('./helpers.mjs').SocialApiContext} apiContext API 上下文
 * @returns {{ vault: object }} vault 命名空间
 */
export function createVaultMethods(apiContext) {
	return {
		vault: {
			/**
			 * @param {object} manifest 文件清单
			 * @returns {Promise<{ entry: object, event: object }>} 注册结果
			 */
			async registerFile(manifest) {
				const entry = await registerVaultFile(apiContext.username, apiContext.entityHash, manifest)
				const event = await commitTimelineEvent(apiContext.username, apiContext.entityHash, {
					type: 'file_share',
					content: {
						shareId: entry.shareId,
						fileId: entry.fileId,
						name: entry.name,
						mimeType: entry.mimeType,
						size: entry.size,
						visibility: entry.visibility,
					},
				}, { fanout: false })
				return { entry, event }
			},
			/**
			 * @param {string} shareId 分享 id
			 * @param {string} [ownerEntityHash] 缺省 = 本实体
			 * @returns {Promise<object | null>} vault 索引项
			 */
			async getFile(shareId, ownerEntityHash) {
				const owner = String(ownerEntityHash || apiContext.entityHash).toLowerCase()
				return getVaultFileByShareId(apiContext.username, owner, String(shareId))
			},
		},
	}
}
