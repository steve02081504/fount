const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'

/**
 * Uploads text to Catbox/Litterbox and returns the file ID.
 * @param {string} content The text content to upload.
 * @param {string} expiration The expiration time for the file (e.g., '1h', '24h').
 * @returns {Promise<string>} The file ID (which is the filename on catbox).
 */
export async function uploadToCatbox(content, expiration = '1h') {
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([content]), 'fount_creds.txt')

	const response = await fetch(CATBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to Catbox: ${await response.text()}`)


	const fileUrl = await response.text()
	// The response is the full URL, e.g., https://litter.catbox.moe/abcdef
	// The fileId is the part after the last slash.
	return new URL(fileUrl).pathname.substring(1)
}
