/**
 * 获取部件列表。
 * @param {string} partType - 部件类型。
 * @returns {Promise<any>} - 部件列表。
 */
export async function getPartList(partType) {
	const response = await fetch('/api/getlist/' + partType)
	return response.json()
}
/**
 * 获取部件类型列表。
 * @returns {Promise<any>} - 部件类型列表。
 */
export async function getPartTypes() {
	const response = await fetch('/api/getparttypelist')
	return response.json()
}
/**
 * 获取角色列表。
 * @returns {Promise<any>} - 角色列表。
 */
export async function getCharList() {
	const response = await fetch('/api/getlist/chars')
	return response.json()
}
/**
 * 获取部件详细信息。
 * @param {string} partType - 部件类型。
 * @param {string} partName - 部件名称。
 * @returns {Promise<any>} - 部件详细信息。
 */
export async function getPartDetails(partType, partName) {
	const response = await fetch(`/api/getdetails/${partType}?name=${partName}`)
	return response.json()
}
/**
 * 无缓存获取部件详细信息。
 * @param {string} partType - 部件类型。
 * @param {string} partName - 部件名称。
 * @returns {Promise<any>} - 部件详细信息。
 */
export async function noCacheGetPartDetails(partType, partName) {
	const response = await fetch(`/api/getdetails/${partType}?name=${partName}&nocache=true`)
	return response.json()
}
/**
 * 获取角色详细信息。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 角色详细信息。
 */
export async function getCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname)
	return response.json()
}
/**
 * 无缓存获取角色详细信息。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 角色详细信息。
 */
export async function noCacheGetCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname + '&nocache=true')
	return response.json()
}
/**
 * 获取世界列表。
 * @returns {Promise<any>} - 世界列表。
 */
export async function getWorldList() {
	const response = await fetch('/api/getlist/worlds')
	return response.json()
}
/**
 * 获取世界详细信息。
 * @param {string} worldname - 世界名称。
 * @returns {Promise<any>} - 世界详细信息。
 */
export async function getWorldDetails(worldname) {
	const response = await fetch('/api/getdetails/worlds?name=' + worldname)
	return response.json()
}
/**
 * 无缓存获取世界详细信息。
 * @param {string} worldname - 世界名称。
 * @returns {Promise<any>} - 世界详细信息。
 */
export async function noCacheGetWorldDetails(worldname) {
	const response = await fetch('/api/getdetails/worlds?name=' + worldname + '&nocache=true')
	return response.json()
}
/**
 * 获取角色卡列表。
 * @returns {Promise<any>} - 角色卡列表。
 */
export async function getPersonaList() {
	const response = await fetch('/api/getlist/personas')
	return response.json()
}
/**
 * 获取角色卡详细信息。
 * @param {string} personaname - 角色卡名称。
 * @returns {Promise<any>} - 角色卡详细信息。
 */
export async function getPersonaDetails(personaname) {
	const response = await fetch('/api/getdetails/personas?name=' + personaname)
	return response.json()
}
/**
 * 无缓存获取角色卡详细信息。
 * @param {string} personaname - 角色卡名称。
 * @returns {Promise<any>} - 角色卡详细信息。
 */
export async function noCacheGetPersonaDetails(personaname) {
	const response = await fetch('/api/getdetails/personas?name=' + personaname + '&nocache=true')
	return response.json()
}
/**
 * 设置默认部件。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<Response>} - 响应。
 */
export async function setDefaultPart(parttype, partname) {
	return fetch('/api/setdefaultpart', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parttype, partname }),
	})
}
/**
 * 获取默认部件。
 * @returns {Promise<any>} - 默认部件。
 */
export async function getDefaultParts() {
	return fetch('/api/getdefaultparts').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取所有缓存的部件详细信息。
 * @param {string} partType - 部件类型。
 * @returns {Promise<any>} - 所有缓存的部件详细信息。
 */
export async function getAllCachedPartDetails(partType) {
	return fetch(`/api/getallcacheddetails/${partType}`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
