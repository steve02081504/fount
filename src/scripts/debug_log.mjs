import fs from 'node:fs'
import path from 'node:path'
import { __dirname } from "../server/base.mjs";

const dir = path.resolve(__dirname + '/debug_logs')

/**
 * @param {string} name Log basename (`.log` appended).
 * @param {unknown} data Payload to append.
 * @returns {Promise<void>}
 */
export async function debugLog(name, data) {
	const text = Object(data) instanceof String ? data : JSON.stringify(data)
	await fs.promises.mkdir(dir, { recursive: true })
	await fs.promises.appendFile(path.join(dir, `${name}.log`), text)
}
