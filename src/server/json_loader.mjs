import fs from 'fs'

export function loadJsonFile(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

export function saveJsonFile(filename, json) {
	fs.writeFileSync(filename, JSON.stringify(json, null, '\t'))
}
