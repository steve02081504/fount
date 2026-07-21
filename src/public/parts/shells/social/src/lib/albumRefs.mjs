import { canViewAlbum } from '../feedVisibility.mjs'

/**
 * 从物化视图提取观看者可见的所属相册摘要。
 * @param {object} view 物化视图
 * @param {string} owner owner
 * @param {string} postId 帖
 * @param {object} viewerContext 观看者
 * @returns {{ albumId: string, name: string }[]} 可见相册
 */
export function albumsForPostFromView(view, owner, postId, viewerContext) {
	const ids = view.albumsByPost?.[postId] || []
	/** @type {{ albumId: string, name: string }[]} */
	const out = []
	for (const albumId of ids) {
		const album = view.albums?.[albumId]
		if (!album || album.virtual) continue
		if (!canViewAlbum(album, owner, viewerContext)) continue
		out.push({ albumId: album.albumId, name: album.name })
	}
	return out
}
