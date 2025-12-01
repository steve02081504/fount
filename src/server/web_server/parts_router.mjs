import express from 'npm:express'

import { WsAbleRouter } from '../../scripts/WsAbleRouter.mjs'
import { auth_request, getUserByReq } from '../auth.mjs'
import { partTypeList } from '../managers/base.mjs'
import { loadPart } from '../managers/index.mjs'

/**
 * 处理特定部件请求的主路由器。
 * @type {import('npm:express').Router}
 */
export const PartsRouter = express.Router()

const PartsRouters = {}
const partsAPIregex = new RegExp(`^/(api|ws|virtual_files)/(${partTypeList.join('|')})/`)
PartsRouter.use(async (req, res, next) => {
	if (!partsAPIregex.test(req.path)) return next()
	if (!await auth_request(req, res)) {
		console.error('skip part router because auth failed')
		return next()
	}
	const { username } = await getUserByReq(req)
	if (!username) return next()
	const parttype = req.path.split('/')[2]
	const partname = req.path.split('/')[3]
	await loadPart(username, parttype, partname).catch(e => {
		console.error(`Failed to load part ${parttype}/${partname} for user ${username}:`, e)
	})
	if (PartsRouters[username]?.[parttype]?.[partname])
		return PartsRouters[username][parttype][partname](req, res, next)
	return next()
})
/**
 * 获取特定部件的路由器。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {import('../../scripts/WsAbleRouter.mjs').WsAbleRouter} 部件的路由器。
 */
export function getPartRouter(username, parttype, partname) {
	PartsRouters[username] ??= {}
	PartsRouters[username][parttype] ??= {}
	return PartsRouters[username][parttype][partname] ??= new WsAbleRouter()
}

/**
 * 删除特定部件的路由器。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {void}
 */
export function deletePartRouter(username, parttype, partname) {
	delete PartsRouters[username][parttype][partname]
	if (!Object.keys(PartsRouters[username][parttype]).length) delete PartsRouters[username][parttype]
	if (!Object.keys(PartsRouters[username]).length) delete PartsRouters[username]
}
