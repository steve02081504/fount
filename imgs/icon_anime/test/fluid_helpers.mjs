/**
 * fluid 测试共用夹具。
 */

import { MAT, createWorld, setMat, addLiquid, clearMaterials } from '../fluid/index.mjs'

/**
 * 创建带 SEAL 边界的流体测试世界。
 * @param {{ fillBottom?: number }} [opts] 密封盒选项
 * @returns {ReturnType<typeof createWorld>} 密封测试世界
 */
const sealedBox = (opts = {}) => {
	const world = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let y = 4; y <= 10; y++)
		for (let x = 4; x <= 10; x++) {
			const edge = y === 4 || y === 10 || x === 4 || x === 10
			if (edge) setMat(world, x, y, MAT.SEAL)
		}
	if (opts.fillBottom)
		for (let x = 5; x <= 9; x++)
			for (let y = 10 - opts.fillBottom; y < 10; y++)
				addLiquid(world, x, y, 1)

	return world
}

/** 密封盒夹具。 */
export { sealedBox }
