/**
 * 气区（Boyle）、全局风、气体速度场。
 * 调用方须在 `stepGas` / 压力查询前先执行 `labelAirRegions`。
 *
 * 开放空气：P = P_ATM + ATM_HYDRO·depth；密闭：等温 Boyle 均值 + ATM_HYDRO·(depth−depthMean)。
 * 速度：风切变 + 喷嘴连续性 + 邻格静压 ΔP（Bernoulli 反馈）。
 * 不做 2D ∇·u=0 投影——指针涡旋/上升气流为有意源项。
 */

import { hash01, fbm1d } from '../hash.mjs'

import { clearLabels, labelComponents, recycleComponents } from './components.mjs'
import {
	P_ATM, RHO_AIR, ATM_HYDRO, GAS_DP_DRIVE, LIQ_DRAW, isBlockMat,
} from './mat.mjs'
import {
	scratch, idx, inWorld, gravityDepth, strongestUp, fillCellDepths,
} from './world.mjs'

/** @typedef {import('./world.mjs').FluidWorld} FluidWorld
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

/** 全局风平均振幅（格/帧）。 */
export const WIND_BASE = 0.38
/** 漂移均值之上的阵风/湍流振幅。 */
export const WIND_GUST = 0.28
/** 边界层切变：u ∝ 高度^power（高处更强）。 */
export const WIND_SHEAR_POWER = 0.55
/** 间歇阵风窗口的帧数。 */
const WIND_GUST_PERIOD = 41
/** 每帧格内气体向风/压力目标的混合系数。 */
export const GAS_BLEND = 0.28
/** 水平通道收窄时的连续性增益。 */
export const GAS_NOZZLE = 1.55
/** 格内气体速度的软上限（格/帧）。 */
export const GAS_SPEED_MAX = 5

/** 每空气格在 P_ATM 下的气体质量单位（Boyle 参考）。 */
const GAS_UNIT_PER_CELL = 1

/**
 * 开放空气在重力深度 `depth` 的静水压（向下 → P↑）。
 * @param {number} depth 重力深度
 * @returns {number} 压力
 */
const openHydroPressure = (depth) => P_ATM + ATM_HYDRO * depth

/**
 * 密闭腔在 Boyle 均值附近的静水压。
 * @param {AirRegion} region 密闭腔区
 * @param {number} depth 当前深度
 * @param {number} depthMean 区平均深度
 * @returns {number} 压力
 */
const sealedHydroPressure = (region, depth, depthMean) =>
	Math.max(0.05, region.pressure + ATM_HYDRO * (depth - depthMean))

/**
 * 格是否为气区泛洪/气体占据意义上的空气格。
 * @param {FluidWorld} world 流体世界
 * @param {number} cell 扁平索引
 * @returns {boolean} 空气格
 */
export const isAirCell = (world, cell) =>
	!isBlockMat(world.mat[cell]) && world.liq[cell] < LIQ_DRAW && world.melt[cell] < LIQ_DRAW

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
			stats.sumDepth += gravityDepth(w, x, y)
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
		const overlap = new Map()
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
}

/**
 * 沿 −ĝ 走线查找上覆气区压力。
 * @param {FluidWorld} world 世界
 * @param {number} x 列
 * @param {number} y 行
 * @param {number} depth 当前深度
 * @returns {number} 压力
 */
const pressureAlongUp = (world, x, y, depth) => {
	const up = strongestUp(world)
	if (up.w <= 0) return openHydroPressure(depth)
	let cx = x
	let cy = y
	const maxSteps = Math.max(world.worldW, world.worldH)
	for (let step = 0; step < maxSteps; step++) {
		cx += up.dx
		cy += up.dy
		if (!inWorld(world, cx, cy)) break
		const above = idx(world, cx, cy)
		if (isBlockMat(world.mat[above])) break
		const aboveRid = world.regionId[above]
		if (aboveRid) {
			const region = world.regions[aboveRid]
			const d = gravityDepth(world, cx, cy)
			return region.openToAtm
				? openHydroPressure(d)
				: sealedHydroPressure(region, d, region.yMean)
		}
	}
	return openHydroPressure(depth)
}

/**
 * 格的热力学/静压气体压力（无动态 Bernoulli 项）。
 * 开放空气：P_ATM + ATM_HYDRO·depth。
 * 密闭：Boyle 均值 + ATM_HYDRO·(depth − depthMean)，使区平均保持 Boyle。
 * 液体格用上覆空气（或大气压）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 压力
 */
export const pressureAt = (world, x, y) => {
	if (!inWorld(world, x, y)) {
		const depth = gravityDepth(world, Math.max(0, x), Math.max(0, y))
		return openHydroPressure(Math.max(0, depth))
	}
	const depth = gravityDepth(world, x, y)
	const cell = idx(world, x, y)
	const rid = world.regionId[cell]
	if (rid) {
		const region = world.regions[rid]
		return region.openToAtm
			? openHydroPressure(depth)
			: sealedHydroPressure(region, depth, region.yMean)
	}
	return pressureAlongUp(world, x, y, depth)
}

/**
 * 时变全局风标量（正 → 沿 ĝ⊥ 右手法向）。
 * @param {number} time 帧
 * @param {number} [seed=0] 场景种子
 * @returns {number} 风速
 */
export const globalWindAt = (time, seed = 0) => {
	const t0 = hash01(seed, 91) * 100
	const synoptic = fbm1d(time * 0.006 + t0, seed + 11, 3)
	const meso = fbm1d(time * 0.022 + t0 * 1.3, seed + 29, 4)
	const micro = fbm1d(time * 0.07 + t0 * 0.7, seed + 47, 5)
	const base = WIND_BASE * (0.55 * synoptic + 0.3 * meso + 0.15 * micro) * 1.65

	const gw = Math.floor(time / WIND_GUST_PERIOD)
	const gHash = hash01(seed + 71, gw)
	if (gHash <= 0.68) return base

	const phase = ((time % WIND_GUST_PERIOD) + WIND_GUST_PERIOD) % WIND_GUST_PERIOD / WIND_GUST_PERIOD
	const rise = 0.22
	const env = phase < rise ? phase / rise : Math.max(0, 1 - (phase - rise) / (1 - rise))
	return base + (base >= 0 ? 1 : -1) * (gHash - 0.68) / 0.32 * WIND_GUST * 1.55 * env * env
}

/**
 * 高度切变因子，范围 (0, 1]：高处（浅深度）更强。
 * @param {number} depth 重力深度
 * @param {number} depthSpan 世界深度跨度
 * @returns {number} 切变
 */
export const windShear = (depth, depthSpan) => {
	const alt = 1 - Math.min(1, Math.max(0, depth / Math.max(1, depthSpan)))
	return 0.28 + 0.72 * alt ** WIND_SHEAR_POWER
}

/** 气体速度采样复用结果。 */
const GAS_VEL = { ux: 0, uy: 0 }

/**
 * 在世界点采样气体速度（最近格）。返回复用对象。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {{ ux: number, uy: number }} 速度
 */
export const gasVelocityAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) {
		GAS_VEL.ux = 0
		GAS_VEL.uy = 0
		return GAS_VEL
	}
	const cell = idx(world, cx, cy)
	GAS_VEL.ux = world.gasUx[cell]
	GAS_VEL.uy = world.gasUy[cell]
	return GAS_VEL
}

/**
 * 世界点水平气体速度（无分配）。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} ux
 */
export const gasUxAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) return 0
	return world.gasUx[idx(world, cx, cy)]
}

/**
 * 动压代理 ½ρu²。
 * @param {number} ux 水平速度
 * @param {number} [uy=0] 垂直速度
 * @returns {number} 动压
 */
export const dynamicPressure = (ux, uy = 0) => 0.5 * RHO_AIR * (ux * ux + uy * uy)

/**
 * Bernoulli 静压：热力学 P − ½ρu²（钳位）。
 * 既作查询，也作 `stepGas` 中驱动邻格 ΔP 的场。
 * @param {FluidWorld} world 流体世界
 * @param {number} x 列
 * @param {number} y 行
 * @returns {number} 静压
 */
export const staticPressureAt = (world, x, y) => {
	const cx = x | 0
	const cy = y | 0
	if (!inWorld(world, cx, cy)) return Math.max(0.05, pressureAt(world, x, y))
	const cell = idx(world, cx, cy)
	return Math.max(0.05, pressureAt(world, x, y) - dynamicPressure(world.gasUx[cell], world.gasUy[cell]))
}

/**
 * 沿列（vert）或行（horiz）填充自由跨度，O(WH)。
 * @param {Uint8Array} blocked 1 = 阻挡
 * @param {number} W 宽
 * @param {number} H 高
 * @param {Uint16Array} outVert 垂直自由跨度
 * @param {Uint16Array} outHoriz 水平自由跨度
 * @returns {void}
 */
const fillGasSpans = (blocked, W, H, outVert, outHoriz) => {
	for (let x = 0; x < W; x++) {
		let y = 0
		while (y < H) {
			while (y < H && blocked[y * W + x]) {
				outVert[y * W + x] = 0
				y++
			}
			const y0 = y
			while (y < H && !blocked[y * W + x]) y++
			const span = y - y0
			for (let yy = y0; yy < y; yy++) outVert[yy * W + x] = span
		}
	}
	for (let y = 0; y < H; y++) {
		let x = 0
		const row = y * W
		while (x < W) {
			while (x < W && blocked[row + x]) {
				outHoriz[row + x] = 0
				x++
			}
			const x0 = x
			while (x < W && !blocked[row + x]) x++
			const span = x - x0
			for (let xx = x0; xx < x; xx++) outHoriz[row + xx] = span
		}
	}
}

/**
 * 推进开放空气/腔体气体速度：风切变、喷嘴连续性、
 * 壁面滑移及邻格静压 ΔP（Bernoulli 抽吸反馈）。
 * 可选 `driveUx`/`driveUy` 叠加局部目标速度（指针风/涡旋）。
 * 需在当前 mat/liq 拓扑下已执行 `labelAirRegions`。
 * @param {FluidWorld} world 流体世界
 * @param {{
 *   time?: number,
 *   seed?: number,
 *   forceWind?: number,
 *   driveUx?: Float32Array,
 *   driveUy?: Float32Array,
 * }} [opts] 驱动选项
 * @returns {void}
 */
export const stepGas = (world, opts) => {
	const time = opts?.time ?? world.gasTime
	const seed = opts?.seed ?? 0
	const forced = opts?.forceWind
	const driveUx = opts?.driveUx
	const driveUy = opts?.driveUy
	world.gasTime = time + 1

	const { worldW: W, worldH: H, regionId, regions, gravity } = world
	const n = W * H
	const gasUx = world.gasUx
	const gasUy = world.gasUy
	const nextUx = scratch(world, 'gasNextUx', n, Float32Array)
	const nextUy = scratch(world, 'gasNextUy', n, Float32Array)
	const blocked = scratch(world, 'gasBlocked', n, Uint8Array)
	const vertSpan = scratch(world, 'gasVertSpan', n, Uint16Array)
	const horizSpan = scratch(world, 'gasHorizSpan', n, Uint16Array)
	const staticP = scratch(world, 'gasStaticP', n, Float32Array)

	if (world.gasGeomDirty) {
		fillBlocked(world, blocked)
		fillGasSpans(blocked, W, H, vertSpan, horizSpan)
		world.gasGeomDirty = false
	}

	const wind0 = forced !== undefined ? forced : globalWindAt(time, seed)
	// Wind direction ⊥ ĝ (clockwise: (gy, −gx) so default g↓ → wind +x).
	const px = gravity.gy
	const py = -gravity.gx
	const depthSpan = world.gravityDepthSpan || Math.max(W, H)
	const depth = fillCellDepths(world)
	const shear = scratch(world, 'gasShear', n, Float32Array)
	let maxUpdraft = 0

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (blocked[cell]) {
				staticP[cell] = 0
				shear[cell] = 0
				continue
			}
			const rid = regionId[cell]
			const region = rid ? regions[rid] : null
			const d = depth[cell]
			shear[cell] = windShear(d, depthSpan)
			const thermo = !region || region.openToAtm
				? openHydroPressure(d)
				: sealedHydroPressure(region, d, region.yMean)
			staticP[cell] = Math.max(0.05, thermo - dynamicPressure(gasUx[cell], gasUy[cell]))
		}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (blocked[cell]) {
				nextUx[cell] = 0
				nextUy[cell] = 0
				continue
			}

			const region = regionId[cell] ? regions[regionId[cell]] : null
			const open = !region || region.openToAtm
			const localDrive = driveUx
				? Math.abs(driveUx[cell]) + Math.abs(driveUy[cell])
				: 0

			const drive = wind0 * shear[cell]
			let tx = open ? drive * px : 0
			let ty = open ? drive * py : 0
			if (driveUx) {
				tx += driveUx[cell]
				ty += driveUy[cell]
			}

			const openL = x > 0 && !blocked[cell - 1]
			const openR = x + 1 < W && !blocked[cell + 1]
			const openU = y > 0 && !blocked[cell - W]
			const openD = y + 1 < H && !blocked[cell + W]

			const p0 = staticP[cell]
			if (openL) tx += -1 * (p0 - staticP[cell - 1]) * GAS_DP_DRIVE
			if (openR) tx += (p0 - staticP[cell + 1]) * GAS_DP_DRIVE
			if (openU) ty += -1 * (p0 - staticP[cell - W]) * GAS_DP_DRIVE
			if (openD) ty += (p0 - staticP[cell + W]) * GAS_DP_DRIVE

			const span = vertSpan[cell]
			if (span <= 4) {
				const wide = Math.max(span, openL ? vertSpan[cell - 1] : span, openR ? vertSpan[cell + 1] : span)
				if (wide > span && Math.abs(tx) > 0.02)
					tx *= Math.min(GAS_NOZZLE * 1.4, wide / span)
			}
			const hSpan = horizSpan[cell]
			if (hSpan <= 4) {
				const wide = Math.max(hSpan, openU ? horizSpan[cell - W] : hSpan, openD ? horizSpan[cell + W] : hSpan)
				if (wide > hSpan && Math.abs(ty) > 0.02)
					ty *= Math.min(GAS_NOZZLE * 1.4, wide / hSpan)
			}

			let ux = gasUx[cell] + (tx - gasUx[cell]) * GAS_BLEND
			let uy = gasUy[cell] + (ty - gasUy[cell]) * GAS_BLEND

			if (!openL && ux < 0) ux = 0
			if (!openR && ux > 0) ux = 0
			if (!openU && uy < 0) uy = 0
			if (!openD && uy > 0) uy = 0

			let sumUx = ux
			let sumUy = uy
			let count = 1
			if (openL) { sumUx += gasUx[cell - 1]; sumUy += gasUy[cell - 1]; count++ }
			if (openR) { sumUx += gasUx[cell + 1]; sumUy += gasUy[cell + 1]; count++ }
			if (openU) { sumUx += gasUx[cell - W]; sumUy += gasUy[cell - W]; count++ }
			if (openD) { sumUx += gasUx[cell + W]; sumUy += gasUy[cell + W]; count++ }
			ux = ux * 0.65 + (sumUx / count) * 0.35
			uy = uy * 0.65 + (sumUy / count) * 0.35

			if (!open && localDrive <= 0.05) {
				ux *= 0.85
				uy *= 0.85
			}

			const outUx = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, ux))
			const outUy = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, uy))
			nextUx[cell] = outUx
			nextUy[cell] = outUy
			// Updraft = velocity against gravity (negative along ĝ).
			const alongG = outUx * gravity.gx + outUy * gravity.gy
			if (alongG < maxUpdraft) maxUpdraft = alongG
		}

	world.scratch.gasNextUx = gasUx
	world.scratch.gasNextUy = gasUy
	world.gasUx = nextUx
	world.gasUy = nextUy
	world.maxUpdraft = maxUpdraft
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
