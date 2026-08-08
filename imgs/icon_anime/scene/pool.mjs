/**
 * 水池渗漏、地表径流与溢出飞溅。
 */

import { MAT, LIQ_DRAW, isLiquidBarrier } from '../fluid/mat.mjs'
import { queueSplash, spawnParticle } from '../fluid/particles.mjs'
import { addLiquid, idx, inWorld } from '../fluid/world/index.mjs'
import { hash01 } from '../hash.mjs'
import { ICON_BASE_ROWS, ICON_BASE_X0 } from '../icon.mjs'

import { BASE_WIDTH } from './materials.mjs'

/** @typedef {import('./create.mjs').AnimState} AnimState */
/** @typedef {import('../fluid/world/index.mjs').FluidWorld} FluidWorld */

/** 地表径流搜索偏移（近 → 远）。 */
const GROUND_DX = [0, -1, 1, -2, 2, -3, 3, -4, 4]

/**
 * 给定行下方下一层底座板世界 Y，无则 -1。
 * @param {AnimState} state 动画状态
 * @param {number} y 当前水池格的世界 Y
 * @returns {number} 下一水池行 Y，或 -1
 */
const nextPoolRow = (state, y) => {
	const local = y - state.iconOy
	for (const br of ICON_BASE_ROWS)
		if (br > local) return state.iconOy + br
	return -1
}

/**
 * 从溢出水池格排队 1–2 个飞溅液滴。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 世界 X
 * @param {number} y 世界 Y
 * @param {number} [targetY=-1] 向下飞溅的目标 Y
 * @returns {void}
 */
const overflowSplash = (world, state, x, y, targetY = -1) => {
	if (world.particles.count > 900) return
	const ny = targetY >= 0 ? targetY : nextPoolRow(state, y)
	const aimY = ny >= 0 ? ny : y + 2
	const n = hash01(x, state.frame) > 0.65 ? 2 : 1
	for (let i = 0; i < n; i++) {
		const splash = queueSplash(world,
			x + (hash01(x, i + 3) - 0.5) * 0.6,
			y + 0.6,
			(hash01(x + i, 5) - 0.5) * 0.35,
			0.45 + hash01(x, 8) * 0.35,
			14 + (hash01(x, 9) * 8 | 0),
		)
		if (splash >= 0 && aimY > y)
			world.pendingSplash.vy[splash] = Math.max(
				world.pendingSplash.vy[splash],
				Math.min(1.1, (aimY - y) * 0.2),
			)
	}
}

/**
 * 将游离液体沉积到 fromY 下方附近的地表列。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 源世界 X
 * @param {number} fromY 源世界 Y（仅在其下方沉积）
 * @param {number} amt 待放置量
 * @returns {number} 成功沉积量
 */
const depositOnGround = (world, state, x, fromY, amt) => {
	let left = amt
	for (const dx of GROUND_DX) {
		if (left < 0.02) break
		const gx = x + dx
		if (!inWorld(world, gx, 0)) continue
		const gy = state.terrain.surface[gx] - 1
		if (gy <= fromY || !inWorld(world, gx, gy)) continue
		const m = world.mat[idx(world, gx, gy)]
		if (isLiquidBarrier(m) || m === MAT.POOL) continue
		const got = addLiquid(world, gx, gy, left)
		if (got <= 0) continue
		left -= got
		if (hash01(gx, state.frame) > 0.4)
			queueSplash(world, gx + 0.2, gy - 0.1,
				(hash01(gx, 3) - 0.5) * 0.4,
				-0.12 - hash01(gx, 4) * 0.2,
				8)
	}
	return amt - left
}

/**
 * 排空水池格：飞溅、溢至下一层板或地表径流。
 * @param {FluidWorld} world 流体世界
 * @param {AnimState} state 动画状态
 * @param {number} x 世界 X
 * @param {number} y 世界 Y
 * @param {number} [force=0] 最小滴落量
 * @returns {void}
 */
export const leakPool = (world, state, x, y, force = 0) => {
	const id = idx(world, x, y)
	const amt = world.liq[id]
	if (amt < 0.12 && force <= 0) return

	const ny = nextPoolRow(state, y)
	const drip = Math.min(amt, Math.max(force, amt * 0.35, 0.12))
	world.liq[id] -= drip
	overflowSplash(world, state, x, y, ny)

	if (ny >= 0) {
		addLiquid(world, x, ny, drip * 0.75)
		return
	}

	const rest = drip - depositOnGround(world, state, x, y, drip)
	if (rest < 0.05) return
	const side = hash01(x, state.frame) > 0.5 ? 1 : -1
	spawnParticle(world,
		x + side * (0.6 + hash01(x, 6) * 1.2),
		y + 0.4,
		side * (0.15 + hash01(x, 7) * 0.25),
		0.35 + hash01(x, 8) * 0.35,
		28,
		rest,
	)
}

/**
 * 对本帧图标底座水池格做渗漏（带随机节流）。
 * @param {AnimState} state 动画状态
 * @returns {void}
 */
export const tickPoolLeaks = (state) => {
	const { world, iconOx, iconOy } = state
	for (const ly of ICON_BASE_ROWS) {
		const y = iconOy + ly
		for (let col = 0; col < BASE_WIDTH; col++) {
			const x = iconOx + ICON_BASE_X0 + col
			if (!inWorld(world, x, y)) continue
			const cell = idx(world, x, y)
			if (world.mat[cell] !== MAT.POOL) continue
			if (world.liq[cell] >= LIQ_DRAW && hash01(x, state.frame) > 0.35)
				leakPool(world, state, x, y)
		}
	}
}
