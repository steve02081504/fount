import { Router } from 'npm:websocket-express'
import { PartsRouter, UpdatePartsRouter } from '../server.mjs'
import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'
import { getUserByReq } from '../auth.mjs'

const shellsRouters = {}
PartsRouter.use(async (req, res, next) => {
	if (!req.path.startsWith('/api/shells/') && !req.path.startsWith('/ws/shells/')) return next()
	const { username } = await getUserByReq(req).catch(_ => ({}))
	if (!username) return next()
	const shellname = req.path.split('/')[3]
	if (shellsRouters[username][shellname])
		return shellsRouters[username][shellname](req, res, next)
	return next()
})
UpdatePartsRouter()

function getShellsPartRouter(username, shellname) {
	shellsRouters[username] ??= {}
	return shellsRouters[username][shellname] ??= new Router()
}

function deleteShellsPartRouter(username, shellname) {
	delete shellsRouters[username][shellname]
}

/**
 *
 * @param {string} username
 * @param {string} shellname
 * @returns {Promise<import('../../decl/shellAPI.ts').shellAPI_t>}
 */
export async function loadShell(username, shellname) {
	const initArgs = {
		router: getShellsPartRouter(username, shellname),
	}
	return loadPartBase(username, 'shells', shellname, initArgs)
}

export async function unloadShell(username, shellname) {
	await unloadPartBase(username, 'shells', shellname, {
		router: getShellsPartRouter(username, shellname),
	})
	deleteShellsPartRouter(username, shellname)
}

export async function initShell(username, shellname) {
	await initPart(username, 'shells', shellname)
}

export async function uninstallShell(username, shellname) {
	await uninstallPartBase(username, 'shells', shellname)
}
