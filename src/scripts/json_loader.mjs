import fs from 'node:fs'

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
		fs.writeFileSync(filename, JSON.stringify(json, null, '\t'))
	}
	catch (error) {
		console.error('Error saving JSON file:', filename, error)
		throw error
	}
}
