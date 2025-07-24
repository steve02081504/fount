export const processTimeStampForId = (time_stamp) =>
	time_stamp.replaceAll(/[\s./:]/g, '_')

export const arrayBufferToBase64 = (buffer) => {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (let i = 0; i < bytes.byteLength; i++)
		binary += String.fromCharCode(bytes[i])
	return window.btoa(binary)
}

export const SWIPE_THRESHOLD = 50
export const TRANSITION_DURATION = 500
export const DEFAULT_AVATAR = 'https://api.iconify.design/line-md/person.svg'
