/**
 * 全局风、气体速度场与 `stepGas` 推进。
 * 调用方须在 `stepGas` 前先执行 `labelAirRegions`。
 *
 * 速度：风切变 + 喷嘴连续性 + 邻格静压 ΔP（Bernoulli 反馈）+ 弱 Boussinesq。
 * 开放气在目标速度合成后做有限次 ∇·u≈0 投影；`driveUx/Uy` 超阈格回注以保留指针涡旋。
 */

import { hash01, fbm1d } from '../../hash.mjs'
import {
	GAS_DP_DRIVE, T_AMB,
} from '../mat.mjs'
import {
	scratch, idx, inWorld, fillCellDepths,
} from '../world/index.mjs'

import { dynamicPressure } from './pressure.mjs'
import { fillBlocked, openHydroPressure, sealedHydroPressure } from './regions.mjs'

/** @typedef {import('../world/index.mjs').FluidWorld} FluidWorld */

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
/** 散度投影 Jacobi 迭代次数。 */
const GAS_PROJ_ITERS = 16
/** |drive| 超过此值的格投影后回注驱动（保留涡旋源）。 */
const GAS_DRIVE_KEEP = 0.08
/** 开放气 Boussinesq 浮力增益（沿 −ĝ）。 */
const GAS_BOUSSINESQ = 0.55

/** 开放邻接位：左 / 右 / 上 / 下。 */
const OPEN_L = 1
const OPEN_R = 2
const OPEN_U = 4
const OPEN_D = 8

/**
 * 由 `blocked` 预计算四邻开放掩码（与投影 / 速度合成共用）。
 * @param {Uint8Array} blocked 阻挡
 * @param {number} W 宽
 * @param {number} H 高
 * @param {Uint8Array} mask 输出
 * @returns {void}
 */
const fillOpenMask = (blocked, W, H, mask) => {
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			if (blocked[cell]) {
				mask[cell] = 0
				continue
			}
			let m = 0
			if (x > 0 && !blocked[cell - 1]) m |= OPEN_L
			if (x + 1 < W && !blocked[cell + 1]) m |= OPEN_R
			if (y > 0 && !blocked[cell - W]) m |= OPEN_U
			if (y + 1 < H && !blocked[cell + W]) m |= OPEN_D
			mask[cell] = m
		}
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
 *   holdVelocity?: boolean,
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
	const openMask = scratch(world, 'gasOpenMask', n, Uint8Array)
	const vertSpan = scratch(world, 'gasVertSpan', n, Uint16Array)
	const horizSpan = scratch(world, 'gasHorizSpan', n, Uint16Array)
	const staticP = scratch(world, 'gasStaticP', n, Float32Array)

	if (world.gasGeomDirty) {
		fillBlocked(world, blocked)
		fillGasSpans(blocked, W, H, vertSpan, horizSpan)
		fillOpenMask(blocked, W, H, openMask)
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
	const holdVelocity = !!opts?.holdVelocity

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

			if (holdVelocity) {
				nextUx[cell] = gasUx[cell]
				nextUy[cell] = gasUy[cell]
				continue
			}

			const region = regionId[cell] ? regions[regionId[cell]] : null
			const openAtm = !region || region.openToAtm
			const localDrive = driveUx
				? Math.abs(driveUx[cell]) + Math.abs(driveUy[cell])
				: 0

			const drive = wind0 * shear[cell]
			let tx = openAtm ? drive * px : 0
			let ty = openAtm ? drive * py : 0
			if (driveUx) {
				tx += driveUx[cell]
				ty += driveUy[cell]
			}
			if (openAtm) {
				const dT = world.temp[cell] - T_AMB
				if (Math.abs(dT) > 0.02) {
					tx -= gravity.gx * dT * GAS_BOUSSINESQ
					ty -= gravity.gy * dT * GAS_BOUSSINESQ
				}
			}

			const neigh = openMask[cell]
			const openL = neigh & OPEN_L
			const openR = neigh & OPEN_R
			const openU = neigh & OPEN_U
			const openD = neigh & OPEN_D

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

			if (!openAtm && localDrive <= 0.05) {
				ux *= 0.85
				uy *= 0.85
			}

			const outUx = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, ux))
			const outUy = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, uy))
			nextUx[cell] = outUx
			nextUy[cell] = outUy
		}

	// --- Divergence projection (Jacobi); skip entirely while pointer drive is active ---
	let hasDrive = false
	if (driveUx)
		for (let i = 0; i < n; i++)
			if (Math.abs(driveUx[i]) + Math.abs(driveUy[i]) > GAS_DRIVE_KEEP) {
				hasDrive = true
				break
			}

	if (!hasDrive) {
		let phi = scratch(world, 'gasProjPhi', n, Float32Array)
		let phiNext = scratch(world, 'gasProjPhiN', n, Float32Array)
		phi.fill(0)
		for (let iter = 0; iter < GAS_PROJ_ITERS; iter++) {
			for (let y = 0; y < H; y++)
				for (let x = 0; x < W; x++) {
					const cell = y * W + x
					if (blocked[cell]) {
						phiNext[cell] = 0
						continue
					}
					const neigh = openMask[cell]
					const openL = neigh & OPEN_L
					const openR = neigh & OPEN_R
					const openU = neigh & OPEN_U
					const openD = neigh & OPEN_D
					let du = 0
					if (openL && openR) du += 0.5 * (nextUx[cell + 1] - nextUx[cell - 1])
					else if (openR) du += nextUx[cell + 1] - nextUx[cell]
					else if (openL) du += nextUx[cell] - nextUx[cell - 1]
					if (openU && openD) du += 0.5 * (nextUy[cell + W] - nextUy[cell - W])
					else if (openD) du += nextUy[cell + W] - nextUy[cell]
					else if (openU) du += nextUy[cell] - nextUy[cell - W]
					let nOpen = 0
					let sum = 0
					if (openL) { sum += phi[cell - 1]; nOpen++ }
					if (openR) { sum += phi[cell + 1]; nOpen++ }
					if (openU) { sum += phi[cell - W]; nOpen++ }
					if (openD) { sum += phi[cell + W]; nOpen++ }
					// ω=1 Jacobi: φ' = (Σφ_n − ∇·u) / nOpen
					phiNext[cell] = nOpen > 0 ? (sum - du) / nOpen : 0
				}
			const swap = phi
			phi = phiNext
			phiNext = swap
		}
		world.scratch.gasProjPhi = phi
		world.scratch.gasProjPhiN = phiNext

		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const cell = y * W + x
				if (blocked[cell]) {
					nextUx[cell] = 0
					nextUy[cell] = 0
					continue
				}
				const neigh = openMask[cell]
				const openL = neigh & OPEN_L
				const openR = neigh & OPEN_R
				const openU = neigh & OPEN_U
				const openD = neigh & OPEN_D
				let gx = 0
				let gy = 0
				if (openL && openR) gx = 0.5 * (phi[cell + 1] - phi[cell - 1])
				else if (openR) gx = phi[cell + 1] - phi[cell]
				else if (openL) gx = phi[cell] - phi[cell - 1]
				if (openU && openD) gy = 0.5 * (phi[cell + W] - phi[cell - W])
				else if (openD) gy = phi[cell + W] - phi[cell]
				else if (openU) gy = phi[cell] - phi[cell - W]
				let ux = nextUx[cell] - gx
				let uy = nextUy[cell] - gy
				if (!openL && ux < 0) ux = 0
				if (!openR && ux > 0) ux = 0
				if (!openU && uy < 0) uy = 0
				if (!openD && uy > 0) uy = 0
				nextUx[cell] = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, ux))
				nextUy[cell] = Math.max(-GAS_SPEED_MAX, Math.min(GAS_SPEED_MAX, uy))
			}
	}

	for (let cell = 0; cell < n; cell++) {
		if (blocked[cell]) continue
		const ux = nextUx[cell]
		const uy = nextUy[cell]
		const alongG = ux * gravity.gx + uy * gravity.gy
		if (alongG < maxUpdraft) maxUpdraft = alongG
	}

	world.scratch.gasNextUx = gasUx
	world.scratch.gasNextUy = gasUy
	world.gasUx = nextUx
	world.gasUy = nextUy
	world.maxUpdraft = maxUpdraft
}
