import fs from 'node:fs'
import sanitize from 'npm:sanitize-filename'
import { loadJsonFile, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../server/auth.mjs'

export function getAISourceFile(username, fileName) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	return loadJsonFile(fname)
}

export function saveAISourceFile(username, fileName, data) {
	const fname = getUserDictionary(username) + '/AIsources/' + sanitize(fileName) + '.json'
	saveJsonFile(fname, data)
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
