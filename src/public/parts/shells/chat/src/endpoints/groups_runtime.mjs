import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { getWorldName } from '../chat/session/channelWorld.mjs'
import { getInitialData } from '../chat/session/crud.mjs'
import {
	addchar,
	addplugin,
	getCharListOfGroup,
	getPluginListOfGroup,
	getUserPersonaName,
	removechar,
	removeplugin,
	setCharReplyFrequency,
	setPersona,
	bindWorld,
} from '../chat/session/partConfig.mjs'
import { registerGroupRuntime } from '../chat/session/runtime.mjs'
import { groupMetadatas } from '../chat/session/wsLifecycle.mjs'
import { GROUPS_PREFIX } from '../group/routes/path.mjs'

import { optionalChannelId, resolveGroupChannel } from './shared.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerGroupsRuntimeRoutes(router) {
	router.get(`${GROUPS_PREFIX}/:groupId/initial-data`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const meta = groupMetadatas.get(groupId)
		if (meta && meta.username !== username)
			throw httpError(403, 'Forbidden')
		res.status(200).json(await getInitialData(groupId))
	})

	router.get(`${GROUPS_PREFIX}/:groupId/chars`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		await registerGroupRuntime(groupId, username)
		res.status(200).json(await getCharListOfGroup(groupId, username))
	})

	router.get(`${GROUPS_PREFIX}/:groupId/plugins`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		res.status(200).json(await getPluginListOfGroup(groupId, username))
	})

	router.get(`${GROUPS_PREFIX}/:groupId/persona`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		res.status(200).json(await getUserPersonaName(groupId, username))
	})

	router.get(`${GROUPS_PREFIX}/:groupId/world`, authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const channelId = await resolveGroupChannel(groupId, optionalChannelId(req.query.channelId), username)
		res.status(200).json(await getWorldName(groupId, channelId))
	})

	router.put(`${GROUPS_PREFIX}/:groupId/char/:charname/frequency`, authenticate, async (req, res) => {
		const { params: { groupId, charname }, body: { frequency } } = req
		const { username } = getUserByReq(req)
		await setCharReplyFrequency(groupId, charname, frequency, username)
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/world`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { worldname, channelId: requestedChannelId } } = req
		const { username } = getUserByReq(req)
		const channelId = await resolveGroupChannel(groupId, optionalChannelId(requestedChannelId), username)
		await bindWorld(groupId, channelId, worldname, username)
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/persona`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { personaname } } = req
		const { username } = getUserByReq(req)
		await setPersona(groupId, personaname, username)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/char`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { charname, deferGreeting } } = req
		const { username } = getUserByReq(req)
		await addchar(groupId, charname, username, { deferGreeting: !!deferGreeting })
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/char/:charname`, authenticate, async (req, res) => {
		const { groupId, charname } = req.params
		await removechar(groupId, charname)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/plugin`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { pluginname } } = req
		await addplugin(groupId, pluginname)
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/plugin/:pluginname`, authenticate, async (req, res) => {
		const { groupId, pluginname } = req.params
		await removeplugin(groupId, pluginname)
		res.status(200).json({})
	})
}
