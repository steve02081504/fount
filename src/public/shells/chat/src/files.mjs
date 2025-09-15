import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import blake2b from 'npm:@bitgo/blake2b-wasm'
import { on_shutdown } from 'npm:on-shutdown'

import { nicerWriteFileSync } from '../../../../scripts/nicerWriteFile.mjs'
import { getAllUserNames, getUserDictionary } from '../../../../server/auth.mjs'
async function gethash(buffer) {
	return new Promise((resolve, reject) => {
		blake2b.ready(function (err) {
			if (err) return reject(err)
			resolve(
				blake2b()
					.update(Buffer.from(buffer))
					.digest('hex')
			)
		})
	})
}
function getUserDir(username) { return getUserDictionary(username) + '/shells/chat/files/' }
export async function checkfile(username, hash) {
	return fs.existsSync(getUserDir(username) + hash)
}
export async function addfile(username, buffer) {
	const hash = await gethash(buffer)
	const userDir = getUserDir(username)
	if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
	nicerWriteFileSync(userDir + hash, buffer)
	return hash
}
export async function getfile(username, hash) {
	return fs.readFileSync(getUserDir(username) + hash)
}

function cleanFiles() {
	const users = getAllUserNames()
	for (const user of users) {
		const userDir = getUserDir(user)
		if (!fs.existsSync(userDir)) continue
		const files = fs.readdirSync(userDir)
		if (!files.length) continue
		const userChatDir = getUserDictionary(user) + '/shells/chat/chats/'
		if (fs.existsSync(userChatDir)) {
			const chatFiles = fs.readdirSync(userChatDir).filter(file => file.endsWith('.json'))
			for (const file of chatFiles) {
				const data = JSON.parse(fs.readFileSync(userChatDir + file))
				for (const entry of data.chatLog || [])
					for (const file of entry.files || [])
						if (file.buffer.startsWith('file:'))
							files.splice(files.indexOf(file.buffer.slice(5)), 1)
			}
		}
		for (const file of files) fs.unlinkSync(userDir + file)
	}
}
export const cleanFilesInterval = setInterval(cleanFiles, 60 * 60 * 1000) // every hour
on_shutdown(cleanFiles)
