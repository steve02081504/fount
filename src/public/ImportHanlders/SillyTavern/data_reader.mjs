import encode from 'npm:png-chunks-encode'
import extract from 'npm:png-chunks-extract'
import { encode as encodeText, decode as decodeText } from 'npm:png-chunk-text'
import { Buffer } from 'node:buffer'

/**
 * Removes 'tEXt' chunks with the keyword 'chara' from a chunks array.
 * @param {Array} chunks Array of PNG chunks
 */
function removeCharaChunks(chunks) {
	for (let i = chunks.length - 1; i >= 0; i--)
		if (chunks[i].name === 'tEXt') {
			const decodedChunk = decodeText(chunks[i].data)
			if (decodedChunk.keyword.toLowerCase() === 'chara')
				chunks.splice(i, 1)

		}
}

/**
 * Writes Character metadata to a PNG image buffer.
 * @param {Buffer} image PNG image buffer
 * @param {string} data Character data to write
 * @returns {Buffer} PNG image buffer with metadata
 */
export function write(image, data) {
	const chunks = extract(image)
	const iendChunkIndex = chunks.findIndex(chunk => chunk.name === 'IEND')

	// Remove existing 'chara' chunks
	removeCharaChunks(chunks)

	// Add new 'tEXt' chunk before 'IEND'
	const base64EncodedData = Buffer.from(data, 'utf8').toString('base64')
	chunks.splice(iendChunkIndex, 0, encodeText('chara', base64EncodedData))

	return Buffer.from(encode(chunks))
}

/**
 * Reads Character metadata from a PNG image buffer.
 * @param {Buffer} image PNG image buffer
 * @returns {string} Character data
 */
export function read(image) {
	const chunks = extract(image)

	const charaChunk = chunks.find(chunk => {
		return chunk.name === 'tEXt' && decodeText(chunk.data).keyword.toLowerCase() === 'chara'
	})

	if (!charaChunk) throw new Error('No PNG metadata.')

	return Buffer.from(decodeText(charaChunk.data).text, 'base64').toString('utf8')
}

/**
 * Removes Character metadata from a PNG image buffer.
 * @param {Buffer} image PNG image buffer
 * @returns {Buffer} PNG image buffer without character metadata
 */
export function remove(image) {
	const chunks = extract(image)

	// Remove existing 'chara' chunks
	removeCharaChunks(chunks)

	return Buffer.from(encode(chunks))
}

export default { read, write, remove }
