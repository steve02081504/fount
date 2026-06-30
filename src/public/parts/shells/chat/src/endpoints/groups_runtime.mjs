import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
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
	setCharSpeakingFrequency,
	setPersona,
	setWorld,
} from '../chat/session/partConfig.mjs'
import { registerGroupRuntime } from '../chat/session/runtime.mjs'
import { groupMetadatas } from '../chat/session/wsLifecycle.mjs'

import { optionalChannelId, resolveGroupChannel } from './shared.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerGroupsRuntimeRoutes(router) {
	router.get('/api/parts/shells\\:chat/groups/:groupId/initial-data', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const meta = groupMetadatas.get(groupId)
		if (meta && meta.username !== username)
			return res.status(403).json({ error: 'Forbidden' })
		res.status(200).json(await getInitialData(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/chars', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		await registerGroupRuntime(groupId, username)
		res.status(200).json(await getCharListOfGroup(groupId, username))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/plugins', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		res.status(200).json(await getPluginListOfGroup(groupId, username))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		res.status(200).json(await getUserPersonaName(groupId, username))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/world', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { username } = getUserByReq(req)
		const channelId = await resolveGroupChannel(groupId, optionalChannelId(req.query.channelId), username)
		res.status(200).json(await getWorldName(groupId, channelId))
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/char/:charname/frequency', authenticate, async (req, res) => {
		const { params: { groupId, charname }, body: { frequency } } = req
		const { username } = getUserByReq(req)
		await setCharSpeakingFrequency(groupId, charname, frequency, username)
		res.status(200).json({})
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/world', authenticate, async (req, res) => {
		const { params: { groupId }, body: { worldname, channelId: requestedChannelId } } = req
		const { username } = getUserByReq(req)
		const channelId = await resolveGroupChannel(groupId, optionalChannelId(requestedChannelId), username)
		await setWorld(groupId, channelId, worldname, username)
		res.status(200).json({})
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { params: { groupId }, body: { personaname } } = req
		const { username } = getUserByReq(req)
		await setPersona(groupId, personaname, username)
		res.status(200).json({})
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/char', authenticate, async (req, res) => {
		const { params: { groupId }, body: { charname, deferGreeting } } = req
		const { username } = getUserByReq(req)
		await addchar(groupId, charname, username, { deferGreeting: !!deferGreeting })
		res.status(200).json({})
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/char/:charname', authenticate, async (req, res) => {
		const { groupId, charname } = req.params
		await removechar(groupId, charname)
		res.status(200).json({})
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/plugin', authenticate, async (req, res) => {
		const { params: { groupId }, body: { pluginname } } = req
		await addplugin(groupId, pluginname)
		res.status(200).json({})
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/plugin/:pluginname', authenticate, async (req, res) => {
		const { groupId, pluginname } = req.params
		await removeplugin(groupId, pluginname)
		res.status(200).json({})
	})
}
