/**
 *
 */
export let currentChatId = null

/**
 *
 * @param endpoint
 * @param method
 * @param body
 */
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/shells/chat/${currentChatId}/${endpoint}`,
		{
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

/**
 *
 */
export async function createNewChat() {
	const response = await fetch('/api/shells/chat/new', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	currentChatId = data.chatid
	return data.chatid
}

/**
 *
 * @param charname
 */
export function addCharacter(charname) {
	return callApi('char', 'POST', { charname })
}

/**
 *
 * @param charname
 */
export function removeCharacter(charname) {
	return callApi(`char/${charname}`, 'DELETE')
}

/**
 *
 * @param worldname
 */
export function setWorld(worldname) {
	return callApi('world', 'PUT', { worldname })
}

/**
 *
 * @param personaname
 */
export function setPersona(personaname) {
	return callApi('persona', 'PUT', { personaname })
}

/**
 *
 * @param charname
 */
export function triggerCharacterReply(charname) {
	return callApi('trigger-reply', 'POST', { charname })
}

/**
 *
 * @param charname
 * @param frequency
 */
export function setCharReplyFrequency(charname, frequency) {
	return callApi(`char/${charname}/frequency`, 'PUT', { frequency })
}

/**
 *
 * @param reply
 */
export function addUserReply(reply) {
	return callApi('message', 'POST', { reply })
}

/**
 *
 * @param index
 */
export function deleteMessage(index) {
	return callApi(`message/${index}`, 'DELETE')
}

/**
 *
 * @param index
 * @param content
 */
export function editMessage(index, content) {
	return callApi(`message/${index}`, 'PUT', { content })
}

/**
 *
 */
export function getCharList() {
	return callApi('chars', 'GET')
}

/**
 *
 * @param start
 * @param end
 */
export function getChatLog(start, end) {
	return callApi(`log?start=${start}&end=${end}`, 'GET')
}

/**
 *
 */
export function getChatLogLength() {
	return callApi('log/length', 'GET')
}

/**
 *
 * @param delta
 */
export function modifyTimeLine(delta) {
	return callApi('timeline', 'PUT', { delta })
}

/**
 *
 */
export function getInitialData() {
	return callApi('initial-data', 'GET')
}

if (window.location.hash)
	currentChatId = window.location.hash.substring(1)
