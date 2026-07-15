import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../../server/auth/index.mjs'
import { getWorldName } from '../../chat/session/channelWorld.mjs'
import {
	getCharListOfGroup,
	getPluginListOfGroup,
	getUserPersonaName,
} from '../../chat/session/partConfig.mjs'
import { registerGroupRuntime } from '../../chat/session/runtime.mjs'
import { getInitialData } from '../../chat/session/sessionQueries.mjs'
import { groupMetadatas } from '../../chat/session/wsLifecycle.mjs'
import { GROUPS_PREFIX } from '../../group/routes/path.mjs'
import { chatClientFromReq, optionalChannelId, resolveGroupChannel } from '../shared.mjs'

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
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.setCharReplyFrequency(charname, frequency)
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/world`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { worldname, channelId: requestedChannelId } } = req
		const { username } = getUserByReq(req)
		const channelId = await resolveGroupChannel(groupId, optionalChannelId(requestedChannelId), username)
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.bindWorld(channelId, worldname)
		res.status(200).json({})
	})

	router.put(`${GROUPS_PREFIX}/:groupId/persona`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { personaname } } = req
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.setPersona(personaname)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/char`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { charname, deferGreeting } } = req
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.addChar(charname, { deferGreeting: !!deferGreeting })
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/char/:charname`, authenticate, async (req, res) => {
		const { groupId, charname } = req.params
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.removeChar(charname)
		res.status(200).json({})
	})

	router.post(`${GROUPS_PREFIX}/:groupId/plugin`, authenticate, async (req, res) => {
		const { params: { groupId }, body: { pluginname } } = req
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.addPlugin(pluginname)
		res.status(200).json({})
	})

	router.delete(`${GROUPS_PREFIX}/:groupId/plugin/:pluginname`, authenticate, async (req, res) => {
		const { groupId, pluginname } = req.params
		const { client } = await chatClientFromReq(req)
		await (await client.group(groupId)).session.removePlugin(pluginname)
		res.status(200).json({})
	})
}
