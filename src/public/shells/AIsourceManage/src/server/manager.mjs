import fs from 'node:fs'
import sanitize from 'npm:sanitize-filename'
import { loadJsonFile, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../server/auth.mjs'
import { isAIsourceLoaded, loadAIsourceGenerator, reloadAIsource } from '../../../../../server/managers/AIsource_manager.mjs'

export function getAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	return loadJsonFile(fname)
}

export async function saveAISourceFile(username, fileName, data) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	saveJsonFile(fname, data)
	if (isAIsourceLoaded(username, sanitize(fileName)))
		await reloadAIsource(username, sanitize(fileName))
}

export function addAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	saveJsonFile(fname, {
		generator: '',
		config: {}
	})
}

export function deleteAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	return fs.promises.unlink(fname)
}

export async function getConfigTemplate(username, generatorname) {
	const generator = await loadAIsourceGenerator(username, generatorname)
	return await generator.interfaces.AIsource.GetConfigTemplate()
}
