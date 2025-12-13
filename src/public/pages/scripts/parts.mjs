/**
 * 获取部件列表。
 * @param {string} partType - 部件类型。
 * @returns {Promise<any>} - 部件列表。
 */
export async function getPartList(partType) {
	return await fetch('/api/getlist/' + partType).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取部件类型列表。
 * @returns {Promise<any>} - 部件类型列表。
 */
export async function getPartTypes() {
	return await fetch('/api/getparttypelist').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取角色列表。
 * @returns {Promise<any>} - 角色列表。
 */
export async function getCharList() {
	return await fetch('/api/getlist/chars').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取部件详细信息。
 * @param {string} partType - 部件类型。
 * @param {string} partName - 部件名称。
 * @returns {Promise<any>} - 部件详细信息。
 */
export async function getPartDetails(partType, partName) {
	return await fetch(`/api/getdetails/${partType}?name=${partName}`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 无缓存获取部件详细信息。
 * @param {string} partType - 部件类型。
 * @param {string} partName - 部件名称。
 * @returns {Promise<any>} - 部件详细信息。
 */
export async function noCacheGetPartDetails(partType, partName) {
	return await fetch(`/api/getdetails/${partType}?name=${partName}&nocache=true`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取角色详细信息。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 角色详细信息。
 */
export async function getCharDetails(charname) {
	return await fetch('/api/getdetails/chars?name=' + charname).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 无缓存获取角色详细信息。
 * @param {string} charname - 角色名称。
 * @returns {Promise<any>} - 角色详细信息。
 */
export async function noCacheGetCharDetails(charname) {
	return await fetch('/api/getdetails/chars?name=' + charname + '&nocache=true').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取世界列表。
 * @returns {Promise<any>} - 世界列表。
 */
export async function getWorldList() {
	return await fetch('/api/getlist/worlds').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取世界详细信息。
 * @param {string} worldname - 世界名称。
 * @returns {Promise<any>} - 世界详细信息。
 */
export async function getWorldDetails(worldname) {
	return await fetch('/api/getdetails/worlds?name=' + worldname).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 无缓存获取世界详细信息。
 * @param {string} worldname - 世界名称。
 * @returns {Promise<any>} - 世界详细信息。
 */
export async function noCacheGetWorldDetails(worldname) {
	return await fetch('/api/getdetails/worlds?name=' + worldname + '&nocache=true').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取角色卡列表。
 * @returns {Promise<any>} - 角色卡列表。
 */
export async function getPersonaList() {
	return await fetch('/api/getlist/personas').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 获取角色卡详细信息。
 * @param {string} personaname - 角色卡名称。
 * @returns {Promise<any>} - 角色卡详细信息。
 */
export async function getPersonaDetails(personaname) {
	return await fetch('/api/getdetails/personas?name=' + personaname).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
/**
 * 无缓存获取角色卡详细信息。
 * @param {string} personaname - 角色卡名称。
 * @returns {Promise<any>} - 角色卡详细信息。
 */
export async function noCacheGetPersonaDetails(personaname) {
	return await fetch('/api/getdetails/personas?name=' + personaname + '&nocache=true').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取插件列表。
 * @returns {Promise<any>} - 插件列表。
 */
export async function getPluginList() {
	return fetch('/api/getlist/plugins').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取插件详细信息。
 * @param {string} pluginname - 插件名称。
 * @returns {Promise<any>} - 插件详细信息。
 */
export async function getPluginDetails(pluginname) {
	return fetch('/api/getdetails/plugins?name=' + pluginname).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 无缓存获取插件详细信息。
 * @param {string} pluginname - 插件名称。
 * @returns {Promise<any>} - 插件详细信息。
 */
export async function noCacheGetPluginDetails(pluginname) {
	return fetch('/api/getdetails/plugins?name=' + pluginname + '&nocache=true').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
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
	return await fetch(`/api/defaultpart/getany/${parttype}`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取用户指定类型的所有默认部件名称。
 * @param {string} parttype - 部件类型。
 * @returns {Promise<string[]>} - 指定类型的所有默认部件名称。
 */
export async function getAllDefaultParts(parttype) {
	return await fetch(`/api/defaultpart/getallbytype/${parttype}`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

/**
 * 获取用户指定类型的一个随机首选默认部件名称。
 * 如果默认列表为空，则从所有可用部件中随机选择一个。
 * @param {string} parttype - 部件类型。
 * @returns {Promise<string | undefined>} - 一个随机的部件名称，如果没有任何可用部件则为 undefined。
 */
export async function getAnyPreferredDefaultPart(parttype) {
	return await fetch(`/api/defaultpart/getanypreferred/${parttype}`).then(async response => {
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
