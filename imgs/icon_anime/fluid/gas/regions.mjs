/**
 * 气区标注、空气格判定与静水压原语。
 * `labelAirRegions` 须在 `stepGas` / 压力查询前执行。
 */

import { clearLabels, labelComponents, recycleComponents } from '../components.mjs'
import {
	P_ATM, ATM_HYDRO, LIQ_DRAW, isBlockMat,
} from '../mat.mjs'
import {
	scratch, fillCellDepths,
} from '../world/index.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld
 * @typedef {{
 *   id: number,
 *   openToAtm: boolean,
 *   airCells: number,
 *   sumY: number,
 *   yMean: number,
 *   gasAmount: number,
 *   pressure: number,
 * }} AirRegion
 */

/** 每空气格在 P_ATM 下的气体质量单位（Boyle 参考）。 */
const GAS_UNIT_PER_CELL = 1

/**
 * 开放空气在重力深度 `depth` 的静水压（向下 → P↑）。
 * @param {number} depth 重力深度
 * @returns {number} 压力
 */
export const openHydroPressure = (depth) => P_ATM + ATM_HYDRO * depth

/**
 * 密闭腔在 Boyle 均值附近的静水压。
 * @param {AirRegion} region 密闭腔区
 * @param {number} depth 当前深度
 * @param {number} depthMean 区平均深度
 * @returns {number} 压力
 */
export const sealedHydroPressure = (region, depth, depthMean) =>
	Math.max(0.05, region.pressure + ATM_HYDRO * (depth - depthMean))

/**
 * 格是否为气区泛洪/气体占据意义上的空气格。
 * @param {FluidWorld} world 流体世界
 * @param {number} cell 扁平索引
 * @returns {boolean} 空气格
 */
export const isAirCell = (world, cell) =>
	!isBlockMat(world.mat[cell]) && world.liq[cell] + world.melt[cell] < LIQ_DRAW

/**
 * 填充阻挡掩码：气体不可占据处为 1。
 * @param {FluidWorld} world 流体世界
 * @param {Uint8Array} blocked 输出掩码
 * @returns {void}
 */
export const fillBlocked = (world, blocked) => {
	for (let cell = 0; cell < blocked.length; cell++)
		blocked[cell] = isAirCell(world, cell) ? 0 : 1
}

/**
 * 重置/分配气区记录（尽量复用池内对象）。
 * @param {AirRegion[]} pool 空闲列表
 * @param {number} id 区 id
 * @param {boolean} openToAtm 是否对大气开放
 * @returns {AirRegion} 气区
 */
const takeRegion = (pool, id, openToAtm) => {
	const region = pool.pop() || {
		id: 0, openToAtm: false, airCells: 0, sumY: 0, yMean: 0,
		gasAmount: 0, pressure: P_ATM,
	}
	region.id = id
	region.openToAtm = openToAtm
	region.airCells = 0
	region.sumY = 0
	region.yMean = 0
	region.gasAmount = 0
	region.pressure = P_ATM
	return region
}

/**
 * 标注气区，拓扑变化时守恒传递气体质量。
 * 对大气开放区取 P = P_ATM；密闭区用 Boyle 均值 + depthMean。
 * 经 `scratch.prevRegionId` 双缓冲 `regionId`。
 * 气区为稠密 id 索引数组（`regions[id]`；槽 0 未用）。
 * @param {FluidWorld} world 流体世界
 * @returns {void}
 */
export const labelAirRegions = (world) => {
	const { worldW: W, worldH: H } = world
	const n = W * H
	const depth = fillCellDepths(world)
	const oldId = world.regionId
	const regionId = clearLabels(world, 'prevRegionId', n)

	const oldRegions = world.regions
	const regionPool = /** @type {AirRegion[]} */ world.scratch.regionPool ??= []
	const oldGas = scratch(world, 'oldRegionGas', Math.max(oldRegions.length, 1), Float32Array)
	oldGas.fill(0)
	for (let id = 1; id < oldRegions.length; id++) {
		const r = oldRegions[id]
		if (!r) continue
		oldGas[id] = r.gasAmount
		regionPool.push(r)
	}

	/** @type {(AirRegion | undefined)[]} */
	const nextRegions = []

	const borderCap = 2 * (W + Math.max(0, H - 2))
	const borderPairs = scratch(world, 'airBorderPairs', Math.max(2, borderCap * 2), Int32Array)
	let borderN = 0
	for (let x = 0; x < W; x++) {
		borderPairs[borderN * 2] = x
		borderPairs[borderN * 2 + 1] = 0
		borderN++
	}
	for (let y = 1; y < H - 1; y++) {
		borderPairs[borderN * 2] = 0
		borderPairs[borderN * 2 + 1] = y
		borderN++
		borderPairs[borderN * 2] = W - 1
		borderPairs[borderN * 2 + 1] = y
		borderN++
	}
	for (let x = 0; x < W; x++) {
		borderPairs[borderN * 2] = x
		borderPairs[borderN * 2 + 1] = H - 1
		borderN++
	}

	const { components, seedComponentId } = labelComponents(world, {
		/**
		 * 泛洪时是否接受该格为空气分量成员。
		 * @param {FluidWorld} w 流体世界
		 * @param {number} cell 扁平索引
		 * @returns {boolean} 空气格
		 */
		accept: (w, cell) => isAirCell(w, cell),
		labels: regionId,
		poolKey: 'airCompPool',
		seedPairs: borderPairs,
		seedPairCount: borderN,
		/**
		 * 每格累加重力深度供分量均值。
		 * @param {FluidWorld} w 流体世界
		 * @param {number} cell 扁平索引
		 * @param {number} x 列
		 * @param {number} y 行
		 * @param {number} id 分量 id
		 * @param {{ sumDepth: number }} stats 分量统计
		 */
		onCell: (w, cell, x, y, id, stats) => {
			stats.sumDepth += depth[cell]
		},
	})

	for (let id = 1; id < components.length; id++) {
		const stats = components[id]
		if (!stats || stats.cells <= 0) continue
		const openToAtm = seedComponentId > 0 && id === seedComponentId
		const region = takeRegion(regionPool, id, openToAtm)
		region.airCells = stats.cells
		region.sumY = stats.sumDepth
		region.yMean = stats.depthMean
		if (openToAtm) {
			region.gasAmount = region.airCells * GAS_UNIT_PER_CELL * P_ATM
			region.pressure = P_ATM
		}
		nextRegions[id] = region
	}
	recycleComponents(world, components, 'airCompPool')

	let hasSealed = false
	for (let id = 1; id < nextRegions.length; id++) {
		const region = nextRegions[id]
		if (region && !region.openToAtm) hasSealed = true
	}

	if (hasSealed) {
		/** @type {Map<number, number>} */
		const overlap = /** @type {Map<number, number>} */ world.scratch.sealedOverlapMap ??= new Map()
		overlap.clear()
		const oldTotal = scratch(world, 'oldRegionTotal', Math.max(oldRegions.length, 1), Float32Array)
		oldTotal.fill(0)
		for (let cell = 0; cell < n; cell++) {
			const old = oldId[cell]
			const nid = regionId[cell]
			if (!old || !nid) continue
			const region = nextRegions[nid]
			if (!region || region.openToAtm) continue
			const key = (old << 16) | nid
			overlap.set(key, (overlap.get(key) || 0) + 1)
			oldTotal[old]++
		}

		const sealedGas = scratch(world, 'sealedGasAcc', nextRegions.length, Float32Array)
		const sealedGot = scratch(world, 'sealedGasGot', nextRegions.length, Uint8Array)
		sealedGas.fill(0)
		sealedGot.fill(0)
		for (const [key, cells] of overlap) {
			const nid = key & 0xffff
			const oldRid = key >>> 16
			if (!oldRegions[oldRid]) continue
			sealedGot[nid] = 1
			sealedGas[nid] += oldGas[oldRid] * (cells / Math.max(1, oldTotal[oldRid]))
		}
		for (let id = 1; id < nextRegions.length; id++) {
			const region = nextRegions[id]
			if (!region || region.openToAtm) continue
			const gas = sealedGot[id] ? sealedGas[id] : region.airCells * GAS_UNIT_PER_CELL * P_ATM
			region.gasAmount = gas
			region.pressure = Math.max(0.05, Math.min(8, gas / Math.max(GAS_UNIT_PER_CELL * 0.25, region.airCells * GAS_UNIT_PER_CELL)))
		}
	}

	world.scratch.prevRegionId = oldId
	world.regionId = regionId
	world.regions = nextRegions
	world.airDirty = false
	world.gasGeomDirty = true
	world.scratch.airEpoch = (/** @type {number} */ world.scratch.airEpoch | 0) + 1
	world.scratch.thermoPEpoch = -1
}

/**
 * 密闭气体总量（供测试）。
 * @param {FluidWorld} world 流体世界
 * @returns {number} 密闭气体质量
 */
export const totalSealedGas = (world) => {
	let gas = 0
	for (let id = 1; id < world.regions.length; id++) {
		const region = world.regions[id]
		if (region && !region.openToAtm) gas += region.gasAmount
	}
	return gas
}
