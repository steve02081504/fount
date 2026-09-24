/** 帖子详情阅读进度：本机隐私，不联邦。 */
import { SOCIAL_BASE, socialRequest } from './client.mjs'

/**
 * 读取单条帖子的阅读进度。
 * @param {string} entityHash 帖子作者 entityHash
 * @param {string} postId 帖 id
 * @returns {Promise<{ progress: object | null }>} 进度记录
 */
export function getReadProgress(entityHash, postId) {
	return socialRequest(`/read-progress/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}`)
}

/**
 * 上报帖子阅读进度（批量 upsert）。
 * @param {object[]} progress 进度条目
 * @returns {Promise<{ saved: number }>} 写入统计
 */
export function saveReadProgress(progress) {
	return socialRequest('/read-progress', { method: 'POST', body: JSON.stringify({ progress }) })
}

/**
 * 页面隐藏 / 卸载时上报阅读进度（sendBeacon 优先，失败退回 fetch）。
 * @param {object[]} progress 进度条目
 * @returns {Promise<void>}
 */
export function saveReadProgressBeacon(progress) {
	const body = JSON.stringify({ progress })
	if (navigator.sendBeacon?.(`${SOCIAL_BASE}/read-progress`, new Blob([body], { type: 'application/json' })))
		return Promise.resolve()
	return saveReadProgress(progress).then(() => { })
}
