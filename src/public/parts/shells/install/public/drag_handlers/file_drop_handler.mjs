import { importFiles } from '../src/endpoints.mjs'

/**
 * Drag-in handler for file drops.
 * Processes dropped files and initiates installation.
 * @param {DataTransfer} dataTransfer - The DataTransfer object from the drop event.
 * @param {object} handlerConfig - The configuration for this handler.
 * @returns {Promise<boolean>} True if handled, false otherwise.
 */
export default async function (dataTransfer, handlerConfig) {
	if (!dataTransfer.files?.length) return false

	const formData = new FormData()
	for (let i = 0; i < dataTransfer.files.length; i++)
		formData.append('files', dataTransfer.files[i])

	const response = await importFiles(formData)
	return response.ok
}
