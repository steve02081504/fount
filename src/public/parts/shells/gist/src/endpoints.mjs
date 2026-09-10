import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { loadRegistryJsonEntries } from '../../../../../server/registries.mjs'

import { createGist, deleteGists, getGist, listGists, updateGist } from './manager.mjs'

const SECURITY_LEVELS = ['secure', 'trusted']

/**
 * 校验 securityLevel 值，非法时抛 400。
 * @param {unknown} level - 待校验的值。
 * @returns {void}
 */
function assertSecurityLevel(level) {
	if (level !== undefined && !SECURITY_LEVELS.includes(level))
		throw httpError(400, `Invalid securityLevel: ${level}`)
}

/**
 * 为 gist shell 设置 API 端点。
 * @param {object} router - Express 的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:gist/gists', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.json(await listGists(username))
	})

	router.post('/api/parts/shells\\:gist/gists', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { markdown, title, securityLevel, source, dedupe } = req.body || {}
		if (!markdown) throw httpError(400, 'markdown is required.')
		if (typeof markdown !== 'string') throw httpError(400, 'markdown must be a string.')
		if (title !== undefined && typeof title !== 'string') throw httpError(400, 'title must be a string.')
		if (dedupe !== undefined && typeof dedupe !== 'boolean') throw httpError(400, 'dedupe must be a boolean.')
		assertSecurityLevel(securityLevel)
		const gist = await createGist(username, { markdown, title, securityLevel, source, dedupe })
		res.status(201).json({ gist })
	})

	router.post('/api/parts/shells\\:gist/gists/batch-delete', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { ids } = req.body || {}
		if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw httpError(400, 'ids must be an array of strings.')
		res.json(await deleteGists(username, ids))
	})

	router.get('/api/parts/shells\\:gist/gists/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const gist = await getGist(username, req.params.id)
		if (!gist) throw httpError(404, 'gist not found.')
		res.json({ gist })
	})

	router.put('/api/parts/shells\\:gist/gists/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { markdown, title, securityLevel } = req.body || {}
		if (markdown !== undefined && typeof markdown !== 'string') throw httpError(400, 'markdown must be a string.')
		if (title !== undefined && typeof title !== 'string') throw httpError(400, 'title must be a string.')
		assertSecurityLevel(securityLevel)
		const gist = await updateGist(username, req.params.id, { markdown, title, securityLevel })
		if (!gist) throw httpError(404, 'gist not found.')
		res.json({ gist })
	})

	router.delete('/api/parts/shells\\:gist/gists/:id', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { deleted } = await deleteGists(username, [req.params.id])
		if (!deleted.length) throw httpError(404, 'gist not found.')
		res.json({ ok: true })
	})

	router.get('/api/parts/shells\\:gist/source-plugins', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const loaded = await loadRegistryJsonEntries(username, 'gist_source_plugins')
		const plugins = loaded.flatMap(({ entry, data }) =>
			(Array.isArray(data) ? data : []).map(item => ({
				...item,
				partpath: item.partpath ?? entry.partpath,
				id: item.id ?? entry.id,
				level: item.level ?? entry.level,
			})))
		res.json({ plugins })
	})
}
