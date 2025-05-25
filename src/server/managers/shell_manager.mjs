import express from 'npm:express@^5.0.1'
// Import wssRouter and PartsRouter. PartsRouter might be used by getShellsPartRouter or directly.
import { PartsRouter, UpdatePartsRouter, wssRouter } from '../server.mjs'; // Changed httpServerInstance to wssRouter
import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'
import { getUserByReq } from '../auth.mjs'

const shellsRouters = {}
PartsRouter.use(async (req, res, next) => {
	if (!req.path.startsWith('/api/shells/')) return next()
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
	return shellsRouters[username][shellname] ??= express.Router()
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
	const shellSpecificRouter = getShellsPartRouter(username, shellname);
	const initArgs = {
		router: shellSpecificRouter, // Keep the shell-specific HTTP router
		wssRouter: wssRouter       // Pass the WssRouter instance
	};
	return loadPartBase(username, 'shells', shellname, initArgs);
}

export async function unloadShell(username, shellname) {
	await unloadPartBase(username, 'shells', shellname, getShellsPartRouter(username, shellname))
	deleteShellsPartRouter(username, shellname)
}

export async function initShell(username, shellname) {
	await initPart(username, 'shells', shellname)
}

export async function uninstallShell(username, shellname) {
	await uninstallPartBase(username, 'shells', shellname)
}
