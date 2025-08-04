import fs from 'node:fs'

import { nicerWriteFileSync } from './nicerWriteFile.mjs'

export function loadJsonFile(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

export function loadJsonFileIfExists(filename, defaultvalue = {}) {
	if (fs.existsSync(filename))
		return loadJsonFile(filename)
	return defaultvalue
}

export function saveJsonFile(filename, json) {
	try {
		nicerWriteFileSync(filename, JSON.stringify(json, null, '\t') + '\n', { encoding: 'utf8' })
	}
	catch (error) {
		console.error('Error saving JSON file:', filename, error)
		throw error
	}
}
