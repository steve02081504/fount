import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { getReadProgress, saveReadProgress } from '../../../../../../server/read_progress.mjs'

import { socialJson } from './shared.mjs'

/** 帖子详情阅读进度保留条数。 */
const MAX_ENTRIES = 1000

/**
 * 观看者实体 → 阅读进度作用域名。
 * @param {string} entityHash 观看者 entityHash
 * @returns {string} 作用域名
 */
function scopeForEntity(entityHash) {
	return `social-${entityHash}`
}

/**
 * 注册帖子详情阅读进度路由（本机隐私，不联邦）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerReadProgressRoutes(router) {
	router.get('/api/parts/shells\\:social/read-progress/:entityHash/:postId', authenticate, socialJson(async (req, { username, client }) => {
		const entityHash = String(req.params.entityHash || '')
		if (!isEntityHash128(entityHash)) throw httpError(400, 'invalid entityHash')
		const postId = String(req.params.postId || '')
		if (!postId) throw httpError(400, 'postId required')
		const progress = await getReadProgress(username, scopeForEntity(client.entityHash), `${entityHash}:${postId}`)
		return { progress }
	}))

	router.post('/api/parts/shells\\:social/read-progress', authenticate, socialJson(async (req, { username, client }) => {
		const rows = Array.isArray(req.body?.progress) ? req.body.progress : []
		const entries = []
		for (const row of rows.slice(0, 20)) {
			const entityHash = String(row?.entityHash || '')
			const postId = String(row?.postId || '')
			if (!isEntityHash128(entityHash) || !postId) continue
			if (!row?.anchor || typeof row.anchor !== 'object') continue
			entries.push({ key: `${entityHash}:${postId}`, anchor: row.anchor, ratio: row.ratio })
		}
		if (!entries.length) return { saved: 0 }
		return saveReadProgress(username, scopeForEntity(client.entityHash), entries, { maxEntries: MAX_ENTRIES })
	}))
}
