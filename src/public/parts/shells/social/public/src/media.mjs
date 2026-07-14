/**
 * Social 媒体附件：EVFS 存储（中立层上传）。
 */
import { uploadEvfsAttachment } from '/parts/shells:chat/shared/evfsMedia.mjs'

const SOCIAL_ATTACHMENT_PREFIX = 'shells/social/attachments'

/**
 * 上传本地媒体文件并返回 mediaRefs 条目。
 * @param {FileList | File[]} files 本地文件
 * @returns {Promise<object[]>} mediaRefs 条目
 */
export async function uploadSocialMedia(files) {
	/** @type {object[]} */
	const refs = []
	for (const file of files) {
		const uploaded = await uploadEvfsAttachment(file, SOCIAL_ATTACHMENT_PREFIX)
		const kind = file.type.startsWith('image/')
			? 'image'
			: file.type.startsWith('video/')
				? 'video'
				: 'file'
		refs.push({
			entityHash: uploaded.entityHash,
			path: uploaded.path,
			url: uploaded.url,
			kind,
			name: file.name,
			mimeType: file.type || 'application/octet-stream',
		})
	}
	return refs
}
