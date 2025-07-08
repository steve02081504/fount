import * as fs from 'node:fs';

/**
 * Write data to a file only if the file doesn't exist or the content has changed.
 * @param {string} filePath - The path to the file to write.
 * @param {string|Buffer} data - The data to write to the file.
 * @param {string} [encoding='utf8'] - The encoding to use when writing the file.
 * @return {void}
 */
export function nicerWriteFileSync(filePath, data, encoding) {
	if (Object(data) instanceof String) encoding ??= 'utf8'
	let oldData
	if (fs.existsSync(filePath))
		oldData = fs.readFileSync(filePath, encoding)
	if (oldData != data)
		fs.writeFileSync(filePath, data, encoding)
}