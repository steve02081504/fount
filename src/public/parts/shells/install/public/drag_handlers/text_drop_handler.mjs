import { importText } from '../src/endpoints.mjs'

/**
 * Drag-in handler for text drops.
 * Processes dropped text and initiates installation.
 * @param {DataTransfer} dataTransfer - The DataTransfer object from the drop event.
 * @param {object} handlerConfig - The configuration for this handler.
 * @returns {Promise<boolean>} True if handled, false otherwise.
 */
export default async function (dataTransfer, handlerConfig) {
	const text = dataTransfer.getData('text/plain')
	if (!text) return false
	const response = await importText(text)
	return response.ok
}
