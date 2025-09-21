import { randomUUID } from 'node:crypto'

import { loadShellData, saveShellData } from '../../../../server/setting_loader.mjs'

const DATA_NAME = 'autorun_scripts'

function getScriptsData(username) {
	const data = loadShellData(username, 'browserIntegration', DATA_NAME)
	if (!data.scripts) 
		data.scripts = []
    
	return data
}

export function listAutoRunScripts(username) {
	const data = getScriptsData(username)
	return data.scripts
}

export function addAutoRunScript(username, { urlRegex, script, comment }) {
	if (!urlRegex || !script) 
		throw new Error('Missing required fields for auto-run script.')
    
	const data = getScriptsData(username)
	const newScript = {
		id: randomUUID(),
		urlRegex,
		script,
		comment: comment || '',
		createdAt: new Date().toISOString(),
	}
	data.scripts.push(newScript)
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return newScript
}

export function removeAutoRunScript(username, id) {
	const data = getScriptsData(username)
	const initialLength = data.scripts.length
	data.scripts = data.scripts.filter(s => s.id !== id)
	if (data.scripts.length === initialLength) 
		return { success: false, message: 'Script not found.' }
    
	saveShellData(username, 'browserIntegration', DATA_NAME)
	return { success: true, message: 'Script removed.' }
}
