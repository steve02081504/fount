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
 * 当前浏览的部件路径（支持多级，如 serviceGenerators/AI）。
 * @type {string}
 */
export let currentPartPath = ''
/**
 * 部件分支树。
 * @type {object | null}
 */
export let partBranches = null

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

/**
 * 设置当前浏览的部件路径。
 * @param {string} value - 新的部件路径。
 */
export function setCurrentPartPath(value) {
	currentPartPath = value
}

/**
 * 设置部件分支树。
 * @param {object | null} value - 部件分支。
 */
export function setPartBranches(value) {
	partBranches = value
}

/**
 * 预加载拖放生成器模块。
 * 这个函数会遍历 homeRegistry 中的所有拖放生成器配置，
 * 动态导入它们，并将导入的默认函数存储在配置对象的 `func` 属性中，
 * 以便 `dragstart` 事件处理程序可以同步访问。
 * @param {object} registry - 当前的 homeRegistry 对象。
 * @returns {Promise<void>}
 */
export async function preloadDragGenerators(registry) {
	if (!registry?.home_drag_out_generators) return

	const loadPromises = registry.home_drag_out_generators.map(async (generatorConfig) => {
		if (generatorConfig.path) try {
			const module = await import(generatorConfig.path)
			generatorConfig.func = module.default
		} catch (error) {
			console.error(`Failed to preload drag generator from ${generatorConfig.path}:`, error)
		}
	})
	await Promise.all(loadPromises)
}
