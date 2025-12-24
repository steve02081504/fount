import { geti18n } from './i18n.mjs'
import { getPartBranches, getPartDetails } from './parts.mjs'

/**
 * 去除首尾斜杠并返回标准化路径。
 * @param {string} partpath 原始部件路径。
 * @returns {string} 标准化的部件路径。
 */
const normalizePath = (partpath) => partpath?.replace(/^\/+|\/+$/g, '') || ''

/**
 * 构建子路径。
 * @param {string} basePath 基础路径。
 * @param {string} child 子节点名称。
 * @returns {string} 完整的子路径。
 */
const buildChildPath = (basePath, child) => normalizePath([basePath, child].filter(Boolean).join('/'))

/**
 * 不区分大小写的字典序排序比较函数。
 * @param {string} a 第一个字符串。
 * @param {string} b 第二个字符串。
 * @returns {number} 比较结果。
 */
const caseInsensitiveSort = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/**
 * 在分支树中获取指定路径对应的节点。
 * @param {object} branches 部件分支树。
 * @param {string} partpath 目标部件路径。
 * @returns {object | null} 找到的节点或 null。
 */
const getNodeByPath = (branches, partpath) => {
	const normalized = normalizePath(partpath)
	if (!normalized) return branches
	let node = branches
	for (const segment of normalized.split('/')) {
		if (!(node instanceof Object)) return null
		node = node[segment]
	}
	return node
}

/**
 * 获取指定路径的直接子节点列表（按字典序排列）。
 * @param {object} branches 部件分支树。
 * @param {string} partpath 目标部件路径。
 * @param {(path: string) => boolean} [filterPath] - 可选的路径过滤函数。
 * @returns {string[]} 子节点名称数组（已排序）。
 */
const getChildrenOfPath = (branches, partpath, filterPath) => {
	const node = getNodeByPath(branches, partpath)
	if (!(node instanceof Object)) return []
	const children = Object.keys(node).sort(caseInsensitiveSort)
	return filterPath ? children.filter(child => filterPath(buildChildPath(partpath, child))) : children
}

/**
 * 判断路径是否为叶子节点（可选择的部件）。
 * @param {object} branches 部件分支树。
 * @param {string} partpath 目标部件路径。
 * @returns {boolean} 是否为叶子节点。
 */
const isLeafPath = (branches, partpath) => {
	const node = getNodeByPath(branches, partpath)
	return node instanceof Object && !Object.keys(node).length
}

/**
 * 深度优先查找第一条可用叶子路径（按字典序）。
 * @param {object} branches 部件分支树。
 * @param {string} [prefix=''] 当前搜索前缀。
 * @param {(path: string) => boolean} [filterPath] - 可选的路径过滤函数。
 * @returns {string} 找到的叶子路径或空串。
 */
const findFirstLeaf = (branches, prefix = '', filterPath) => {
	if (!(branches instanceof Object)) return ''
	const keys = Object.keys(branches).sort(caseInsensitiveSort)
	for (const key of keys) {
		const currentPath = buildChildPath(prefix, key)
		if (filterPath && !filterPath(currentPath)) continue
		if (isLeafPath(branches, currentPath)) return currentPath
		const childLeaf = findFirstLeaf(branches[key], currentPath, filterPath)
		if (childLeaf) return childLeaf
	}
	return ''
}

/**
 * 判断某路径是否存在名为 parts 的接口。
 * 检查部件的 supportedInterfaces 是否包含 'parts'。
 * @param {string} path - 部件路径。
 * @returns {Promise<boolean>} 是否存在 parts 接口。
 */
async function hasPartsInterface(path) {
	try {
		const partDetails = await getPartDetails(path, true)
		return partDetails?.supportedInterfaces?.includes('parts') === true
	} catch {
		return false
	}
}

/**
 * 创建部件路径面包屑选择器。
 * @param {object} options - 配置项。
 * @param {HTMLElement} options.dropdown - 包裹面包屑和菜单的下拉容器。
 * @param {HTMLElement} options.breadcrumbList - 显示路径的 `<ul>`。
 * @param {HTMLElement} options.menu - 展开的菜单容器。
 * @param {(path: string) => void} options.onChange - 选中路径时的回调。
 * @param {string} [options.initialPath] - 初始路径。
 * @param {(path: string) => boolean} [options.filterPath] - 可选的路径过滤函数，返回 true 表示路径可用。
 * @param {(path: string) => Promise<void>} [options.onOpenMenu] - 可选的回调，在打开菜单时触发，用于预加载详情。
 * @returns {Promise<{ setPath: (path: string) => void, getPath: () => string }>} 选择器控制器。
 */
export async function createPartpathPicker({
	dropdown,
	breadcrumbList,
	menu,
	onChange,
	initialPath = '',
	filterPath,
	onOpenMenu,
}) {
	const branches = await getPartBranches().catch(error => {
		console.error('Failed to load part branches:', error)
		return {}
	})

	let currentPath = ''

	/**
	 * 检查路径是否存在（无论是叶子节点还是父节点）。
	 * @param {string} partpath 目标部件路径。
	 * @returns {boolean} 路径是否存在。
	 */
	const pathExists = (partpath) => {
		const normalized = normalizePath(partpath)
		const node = getNodeByPath(branches, normalized)
		if (!(node instanceof Object)) return !normalized && (!filterPath || filterPath(''))
		return !filterPath || filterPath(normalized)
	}

	/**
	 * 设置当前选中的路径。
	 * @param {string} targetPath 目标部件路径。
	 */
	const setPath = (targetPath) => {
		const normalized = normalizePath(targetPath)
		// 允许空路径（根路径）
		if (normalized && !pathExists(normalized)) return
		// 如果路径相同，跳过更新以避免循环
		if (currentPath === (normalized || '')) return
		currentPath = normalized || ''
		renderBreadcrumb()
		onChange?.(currentPath)
	}

	/**
	 * 渲染面包屑展示当前路径。
	 */
	const renderBreadcrumb = () => {
		breadcrumbList.innerHTML = ''
		const segments = currentPath ? currentPath.split('/') : []
		const trail = ['parts', ...segments]
		trail.forEach((segment, index) => {
			const li = document.createElement('li')
			const a = document.createElement('a')
			a.textContent = segment
			a.title = geti18n('breadcrumb.clickToNavigate', { path: segment }) || segment
			a.href = '#'
			a.addEventListener('click', event => {
				event.preventDefault()
				const targetPath = index === 0 ? '' : segments.slice(0, index).join('/')
				if (targetPath === currentPath) {
					dropdown.classList.remove('dropdown-open')
					return
				}
				dropdown.classList.remove('dropdown-open')
				setPath(targetPath)
				const children = getChildrenOfPath(branches, targetPath, filterPath)
				if (children.length > 0)
					requestAnimationFrame(() => {
						requestAnimationFrame(() => openMenu(targetPath))
					})

			})
			li.appendChild(a)
			breadcrumbList.appendChild(li)
		})
	}

	/**
	 * 安全调用 onOpenMenu 回调。
	 * @param {string} path 路径。
	 */
	const safePreload = async (path) => {
		try {
			await onOpenMenu?.(path)
		}
		catch (error) {
			console.error(`Failed to preload details for ${path}:`, error)
		}
	}

	/**
	 * 打开路径选择菜单。
	 * @param {string} basePath 当前父路径。
	 */
	const openMenu = async (basePath) => {
		await safePreload(basePath)
		const children = getChildrenOfPath(branches, basePath, filterPath)
		menu.innerHTML = ''

		// 并行检查所有子路径是否有 parts 接口
		const hasPartsPromises = children.map(child => {
			const nextPath = buildChildPath(basePath, child)
			return hasPartsInterface(nextPath).then(hasParts => ({ child, nextPath, hasParts }))
		})
		const childrenWithParts = await Promise.all(hasPartsPromises)

		childrenWithParts.forEach(({ child, nextPath, hasParts }) => {
			const li = document.createElement('li')
			const a = document.createElement('a')
			a.textContent = child + (hasParts ? ' /' : '')
			a.href = '#'
			a.addEventListener('click', async event => {
				event.preventDefault()
				setPath(nextPath)
				await safePreload(nextPath)
				await openMenu(nextPath)
			})
			li.appendChild(a)
			menu.appendChild(li)
		})
		dropdown.classList.toggle('dropdown-open', children.length > 0)
	}

	dropdown.addEventListener('click', async event => {
		if (event.target.closest('a, button, input, select, textarea')) return
		const parentPath = currentPath ? currentPath.split('/').slice(0, -1).join('/') : ''
		await openMenu(parentPath)
	})

	document.addEventListener('click', event => {
		if (!dropdown.contains(event.target))
			dropdown.classList.remove('dropdown-open')
	}, { capture: true })

	// 初始化路径
	const normalizedInitial = normalizePath(initialPath)
	const fallbackPath = normalizedInitial && pathExists(normalizedInitial)
		? normalizedInitial
		: findFirstLeaf(branches, '', filterPath)

	if (fallbackPath)
		setPath(fallbackPath)

	else if (normalizedInitial) {
		currentPath = normalizedInitial
		renderBreadcrumb()
	}

	return {
		setPath,
		/**
		 * 获取当前选中的部件路径。
		 * @returns {string} 当前路径。
		 */
		getPath: () => currentPath,
	}
}
