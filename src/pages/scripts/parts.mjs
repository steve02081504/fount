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
 * 将部件添加到用户的默认部件列表。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<Response>} - 响应。
 */
export async function addDefaultPart(parttype, partname) {
	return fetch('/api/defaultpart/add', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parttype, partname }),
	})
}

/**
 * 从用户的默认部件列表中移除一个部件。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 要移除的部件名称。
 * @returns {Promise<Response>} - 响应。
 */
export async function unsetDefaultPart(parttype, partname) {
	return fetch('/api/defaultpart/unset', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parttype, partname }),
	})
}
/**
 * 获取默认部件。
 * @returns {Promise<Record<string, string[]>>} - 默认部件。
 */
export async function getDefaultParts() {
	return fetch('/api/defaultpart/getall').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取用户指定类型的一个随机默认部件名称。
 * @param {string} parttype - 部件类型。
 * @returns {Promise<string | undefined>} - 一个随机的部件名称，如果列表为空则为 undefined。
 */
export async function getAnyDefaultPart(parttype) {
	const response = await fetch(`/api/defaultpart/getany/${parttype}`)
	return response.json()
}

/**
 * 获取用户指定类型的所有默认部件名称。
 * @param {string} parttype - 部件类型。
 * @returns {Promise<string[]>} - 指定类型的所有默认部件名称。
 */
export async function getAllDefaultParts(parttype) {
	const response = await fetch(`/api/defaultpart/getallbytype/${parttype}`)
	return response.json()
}

/**
 * 获取用户指定类型的一个随机首选默认部件名称。
 * 如果默认列表为空，则从所有可用部件中随机选择一个。
 * @param {string} parttype - 部件类型。
 * @returns {Promise<string | undefined>} - 一个随机的部件名称，如果没有任何可用部件则为 undefined。
 */
export async function getAnyPreferredDefaultPart(parttype) {
	const response = await fetch(`/api/defaultpart/getanypreferred/${parttype}`)
	return response.json()
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
