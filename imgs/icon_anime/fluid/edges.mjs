/**
 * 重力相对边界几何：环绕与上下边判定（无动力学副作用）。
 */

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld */

/**
 * 边界角色轴。
 * @param {FluidWorld} world 世界
 * @returns {{ downAxis: 0|1, downSign: 1|-1, wrapAxis: 0|1 }} 角色
 */
export const boundaryAxes = (world) => {
	const { axis, sign } = world.gravity
	return {
		downAxis: axis,
		downSign: sign,
		wrapAxis: /** @type {0|1} */ (1 - axis),
	}
}

/**
 * 将垂直于重力的坐标取模环绕。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {{ x: number, y: number }} 环绕后坐标
 */
export const wrapSide = (world, x, y) => {
	const { wrapAxis } = boundaryAxes(world)
	const W = world.worldW
	const H = world.worldH
	if (wrapAxis === 0) {
		let nx = x % W
		if (nx < 0) nx += W
		return { x: nx, y }
	}
	let ny = y % H
	if (ny < 0) ny += H
	return { x, y: ny }
}

/**
 * 邻格坐标（侧边环绕；上下不环绕）。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} dx 偏移
 * @param {number} dy 偏移
 * @returns {{ x: number, y: number, wrapped: boolean, out: boolean }} 结果
 */
export const neighborCoord = (world, x, y, dx, dy) => {
	const { downAxis } = boundaryAxes(world)
	let nx = x + dx
	let ny = y + dy
	const W = world.worldW
	const H = world.worldH

	if (downAxis === 1) {
		if (nx < 0 || nx >= W) {
			const w = wrapSide(world, nx, ny)
			return { x: w.x, y: w.y, wrapped: true, out: false }
		}
		if (ny < 0 || ny >= H)
			return { x: nx, y: ny, wrapped: false, out: true }
		return { x: nx, y: ny, wrapped: false, out: false }
	}
	if (ny < 0 || ny >= H) {
		const w = wrapSide(world, nx, ny)
		return { x: w.x, y: w.y, wrapped: true, out: false }
	}
	if (nx < 0 || nx >= W)
		return { x: nx, y: ny, wrapped: false, out: true }
	return { x: nx, y: ny, wrapped: false, out: false }
}

/**
 * 点是否在重力下边。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 下边
 */
export const onDownEdge = (world, x, y) => {
	const { axis, sign } = world.gravity
	if (axis === 1) return sign > 0 ? y >= world.worldH - 1 : y <= 0
	return sign > 0 ? x >= world.worldW - 1 : x <= 0
}

/**
 * 点是否在重力上边。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {boolean} 上边
 */
export const onUpEdge = (world, x, y) => {
	const { axis, sign } = world.gravity
	if (axis === 1) return sign > 0 ? y <= 0 : y >= world.worldH - 1
	return sign > 0 ? x <= 0 : x >= world.worldW - 1
}
