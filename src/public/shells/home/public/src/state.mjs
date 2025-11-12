/**
 * 主页 shell 的全局状态管理。
 * 包含应用程序的共享数据和配置。
 */
/**
 * 主页注册表对象，包含所有部件类型、功能按钮和拖放处理程序。
 * @type {object | null}
 */
export let homeRegistry = null
/**
 * 用户的默认部件列表，按部件类型分类。
 * @type {object}
 */
export let defaultParts = {}
/**
 * SFW（安全工作）模式是否启用。
 * @type {boolean}
 */
export let isSfw = false
/**
 * 当前选定的部件类型对象。
 * @type {object | null}
 */
export let currentPartType = null

/**
 * 设置主页注册表对象。
 * @param {object | null} value - 新的主页注册表对象。
 */
export function setHomeRegistry(value) {
	homeRegistry = value
}

/**
 * 设置默认部件列表。
 * @param {object} value - 新的默认部件列表。
 */
export function setDefaultParts(value) {
	defaultParts = value
}

/**
 * 设置 SFW（安全工作）模式是否启用。
 * @param {boolean} value - SFW 模式的新状态。
 */
export function setIsSfw(value) {
	isSfw = value
}

/**
 * 设置当前选定的部件类型对象。
 * @param {object | null} value - 新的当前选定的部件类型对象。
 */
export function setCurrentPartType(value) {
	currentPartType = value
}
