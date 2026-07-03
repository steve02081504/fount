import { access } from 'node:fs/promises'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { groupDir } from '../chat/lib/paths.mjs'
import {
	copyGroupChat,
	deleteGroup,
	exportGroupChat,
	importGroupChat,
	listGroupSessions,
} from '../chat/session/crud.mjs'
import { groupMetadatas } from '../chat/session/wsLifecycle.mjs'
import { GROUPS_PREFIX } from '../group/routes/path.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSessionRoutes(router) {
	router.get('/api/parts/shells\\:chat/sessions/list', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await listGroupSessions(username))
	})

	router.delete('/api/parts/shells\\:chat/sessions/:groupId', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const owner = groupMetadatas.get(groupId)?.username
		if (owner && owner !== username)
			throw httpError(403, 'Permission denied')
		try {
			await access(groupDir(username, groupId))
		}
		catch {
			throw httpError(404, 'Group not found')
		}
		const [result] = await deleteGroup([groupId], username)
		if (result?.error)
			throw httpError(500, result.error)
		res.status(200).json({})
	})

	router.get(`${GROUPS_PREFIX}/:groupId/export`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const owner = groupMetadatas.get(groupId)?.username
		if (owner && owner !== username)
			throw httpError(403, 'Permission denied')
		try {
			await access(groupDir(username, groupId))
		}
		catch {
			throw httpError(404, 'Group not found')
		}
		res.status(200).json(await exportGroupChat(groupId))
	})

	router.post(`${GROUPS_PREFIX}/import`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await importGroupChat(req.body, username))
	})

	router.post(`${GROUPS_PREFIX}/:groupId/copy`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const owner = groupMetadatas.get(groupId)?.username
		if (owner && owner !== username)
			throw httpError(403, 'Permission denied')
		try {
			await access(groupDir(username, groupId))
		}
		catch {
			throw httpError(404, 'Group not found')
		}
		res.status(200).json(await copyGroupChat(groupId, username))
	})
}
