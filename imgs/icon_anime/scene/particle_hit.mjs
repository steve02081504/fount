/**
 * 粒子撞击材质时的场景响应。
 */

import { MAT, SOIL_HIT_ABSORB_FRAC, soilAbsorbFactor, isLiquidBarrier } from '../fluid/mat.mjs'
import { queueSplash } from '../fluid/particles.mjs'
import { addLiquid, addMoisture, idx, impartLiquidMomentum } from '../fluid/world/index.mjs'
import { hash01 } from '../hash.mjs'
import { ICON_BASE_ROWS } from '../icon.mjs'

import { leakPool } from './pool.mjs'

/** @typedef {import('../fluid/particles.mjs').ParticleView} ParticleView */

/**
 * 粒子撞击处理：水池渗漏、体部飞溅、土壤吸收、斜坡。
 * @param {import('../fluid/world/index.mjs').FluidWorld} world 流体世界
 * @param {number} x 撞击格 X
 * @param {number} y 撞击格 Y
 * @param {number} m 撞击处材质
 * @param {ParticleView} particle 粒子视图
 * @param {boolean} wet 粒子是否带水质量
 * @param {import('./create.mjs').AnimState} state 动画状态
 * @returns {void}
 */
export const onParticleHit = (world, x, y, m, particle, wet, state) => {
	const { frame } = state

	if (m === MAT.POOL) {
		const i = idx(world, x, y)
		const before = world.liq[i]
		const stored = addLiquid(world, x, y, 0.15)
		impartLiquidMomentum(world, i, before, stored, particle.vx, particle.vy)
		if (hash01(x, frame) > 0.3)
			leakPool(world, state, x, y, 0.08)
		return
	}

	if (m === MAT.BODY) {
		const speed = Math.hypot(particle.vx, particle.vy) || 0.5
		queueSplash(world,
			x + (hash01(x, 1) - 0.5) * 0.5,
			y - 0.15,
			(hash01(x, frame) - 0.5) * speed * 0.85,
			-0.18 - hash01(x, 3) * 0.35,
			8 + (hash01(x, 4) * 6 | 0),
		)
		if (hash01(x, frame) > 0.45)
			queueSplash(world,
				x + (hash01(x, 5) - 0.5) * 0.4,
				y - 0.05,
				(hash01(x, 6) - 0.5) * speed * 0.5,
				-0.1 - hash01(x, 7) * 0.2,
				6,
			)
		return
	}

	if (m === MAT.HORIZON || m === MAT.SOLID) {
		const i = idx(world, x, y)
		const hit = 0.18
		const stored = addMoisture(world, x, y, hit * SOIL_HIT_ABSORB_FRAC * soilAbsorbFactor(world.moisture[i]))
		const rest = hit - stored
		if (rest > 0 && y > 0 && !isLiquidBarrier(world.mat[idx(world, x, y - 1)])) {
			const ai = idx(world, x, y - 1)
			const before = world.liq[ai]
			const put = addLiquid(world, x, y - 1, rest)
			impartLiquidMomentum(world, ai, before, put, particle.vx * 0.5, particle.vy * 0.35)
		}
		const wetSoil = world.moisture[i] > 0.15
		queueSplash(world, x, y - 0.25,
			(hash01(x, frame) - 0.5) * (wetSoil ? 0.45 : 0.3),
			-0.15 - hash01(x, 2) * (wetSoil ? 0.25 : 0.15),
			wetSoil ? 8 : 6,
		)
		return
	}

	if (m === MAT.SEAL) {
		const speed = Math.hypot(particle.vx, particle.vy) || 0.5
		queueSplash(world, x + (hash01(x, 1) - 0.5), y - 0.15,
			(hash01(x, frame) - 0.5) * speed,
			-0.2 - hash01(x, 3) * 0.3,
			10)
		return
	}

	if (m === MAT.SLOPE_R || m === MAT.SLOPE_L) {
		const side = m === MAT.SLOPE_R ? 1 : -1
		const speed = Math.hypot(particle.vx, particle.vy) || 0.6
		queueSplash(world, x + side * 0.4, y + 0.2, side * speed * 0.7, speed * 0.7, 14)
		if (hash01(x, frame) > 0.4)
			queueSplash(world, x + side * 0.2, y - 0.1, side * speed * 0.4, -speed * 0.2, 8)
		return
	}

	if (wet) {
		const i = idx(world, x, y)
		const before = world.liq[i]
		const stored = addLiquid(world, x, y, 0.2)
		impartLiquidMomentum(world, i, before, stored, particle.vx, particle.vy)
		const local = y - state.iconOy
		if (ICON_BASE_ROWS.some(br => Math.abs(br - local) <= 1))
			leakPool(world, state, x, y, 0.1)
	}
}
