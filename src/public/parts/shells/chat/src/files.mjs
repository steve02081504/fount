import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { setInterval } from 'node:timers'

import blake2b from 'npm:@bitgo/blake2b-wasm'
import { on_shutdown } from 'npm:on-shutdown'

import { ms } from '../../../../../scripts/ms.mjs'
import { nicerWriteFileSync } from '../../../../../scripts/nicerWriteFile.mjs'
import { getAllUserNames, getUserDictionary } from '../../../../../server/auth.mjs'
/**
 * 获取buffer的hash值。
 * @param {Buffer} buffer - 输入的buffer。
 * @returns {Promise<string>} - hash值。
 */
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
/**
 * 获取用户目录。
 * @param {string} username - 用户名。
 * @returns {string} - 用户目录路径。
 */
function getUserDir(username) { return getUserDictionary(username) + '/shells/chat/files/' }
/**
 * 检查文件是否存在。
 * @param {string} username - 用户名。
 * @param {string} hash - 文件hash。
 * @returns {Promise<boolean>} - 文件是否存在。
 */
export async function checkfile(username, hash) {
	return fs.existsSync(getUserDir(username) + hash)
}
/**
 * 添加文件。
 * @param {string} username - 用户名。
 * @param {Buffer} buffer - 文件buffer。
 * @returns {Promise<string>} - 文件hash。
 */
export async function addfile(username, buffer) {
	const hash = await gethash(buffer)
	const userDir = getUserDir(username)
	if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
	nicerWriteFileSync(userDir + hash, buffer)
	return hash
}
/**
 * 获取文件。
 * @param {string} username - 用户名。
 * @param {string} hash - 文件hash。
 * @returns {Promise<Buffer>} - 文件buffer。
 */
export async function getfile(username, hash) {
	return fs.readFileSync(getUserDir(username) + hash)
}

/**
 * 清理文件。
 */
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
/**
 * 清理文件的定时器。
 */
export const cleanFilesInterval = setInterval(cleanFiles, ms('1h')).unref() // every hour
on_shutdown(cleanFiles)
