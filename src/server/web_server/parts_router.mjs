import express from 'npm:express'

import { WsAbleRouter } from '../../scripts/WsAbleRouter.mjs'
import { auth_request, getUserByReq } from '../auth.mjs'
import { loadPart } from '../parts_loader.mjs'

/**
 * 处理特定部件请求的主路由器。
 * @type {import('npm:express').Router}
 */
export const PartsRouter = express.Router()

const PartsRouters = {}
// Regex to match /(api|ws|virtual_files)/parts/<partpath>/<apipath> where partpath may contain colons
const partsAPIregex = /^\/(api|ws|virtual_files)\/parts\/([^/]+)/
PartsRouter.use(async (req, res, next) => {
	const match = partsAPIregex.exec(req.path)
	if (!match) return next()
	if (!await auth_request(req, res)) {
		console.error('skip part router because auth failed')
		return next()
	}
	const { username } = await getUserByReq(req)
	if (!username) return next()

	const partpath = match[2].replace(/:/g, '/')

	// Load the part
	await loadPart(username, partpath).catch(e => {
		console.error(`Failed to load part ${partpath} for user ${username}:`, e)
	})

	if (PartsRouters[username]?.[partpath])
		return PartsRouters[username][partpath](req, res, next)
	return next()
})
/**
 * 获取特定部件的路由器。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {import('../../scripts/WsAbleRouter.mjs').WsAbleRouter} 部件的路由器。
 */
export function getPartRouter(username, partpath) {
	PartsRouters[username] ??= {}
	return PartsRouters[username][partpath] ??= new WsAbleRouter()
}

/**
 * 删除特定部件的路由器。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {void}
 */
export function deletePartRouter(username, partpath) {
	delete PartsRouters[username][partpath]
	if (!Object.keys(PartsRouters[username]).length) delete PartsRouters[username]
}
