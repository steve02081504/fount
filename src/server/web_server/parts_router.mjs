import express from 'npm:express'
import { Router as WsAbleRouter } from 'npm:websocket-express'

import { getUserByReq } from '../auth.mjs'
import { partsList } from '../managers/base.mjs'

export const PartsRouter = express.Router()

const PartsRouters = {}
const partsAPIregex = new RegExp(`^/(api|ws)/(${partsList.join('|')})/`)
PartsRouter.use(async (req, res, next) => {
	if (!partsAPIregex.test(req.path)) return next()
	const { username } = await getUserByReq(req).catch(_ => ({}))
	if (!username) return next()
	const parttype = req.path.split('/')[2]
	const partname = req.path.split('/')[3]
	if (PartsRouters[username]?.[parttype]?.[partname])
		return PartsRouters[username][parttype][partname](req, res, next)
	return next()
})
export function getPartRouter(username, parttype, partname) {
	PartsRouters[username] ??= {}
	PartsRouters[username][parttype] ??= {}
	return PartsRouters[username][parttype][partname] ??= new WsAbleRouter()
}

export function deletePartRouter(username, parttype, partname) {
	delete PartsRouters[username][parttype][partname]
	if (!Object.keys(PartsRouters[username][parttype]).length) delete PartsRouters[username][parttype]
	if (!Object.keys(PartsRouters[username]).length) delete PartsRouters[username]
}
