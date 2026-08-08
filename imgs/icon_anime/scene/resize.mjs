/**
 * 视口缩放：保留既有地形 / 动力学，仅为新暴露区域生成。
 */

import { MAT, SOIL_CAP, T_AMB } from '../fluid/mat.mjs'
import { spawnParticle } from '../fluid/particles.mjs'
import { stepResizeWeather } from '../fluid/step.mjs'
import {
	createWorld, addLiquid, addMelt, idx, inWorld,
} from '../fluid/world/index.mjs'
import {
	ICON_W, ICON_H, ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1,
} from '../icon.mjs'
import { resizeTerrain } from '../terrain/index.mjs'

import { BOTTOM_EXTRA, VIEW_MARGIN, iconOrigin } from './create.mjs'
import { rebuildMaterials, refreshLandGeometry } from './materials.mjs'

/** @typedef {import('./create.mjs').AnimState} AnimState */
/** @typedef {import('./create.mjs').FluidWorld} FluidWorld */

/** 扩张后新暴露地形应用的土壤沉降 tick 数。 */
export const RESIZE_WEATHER_TICKS = 12

/**
 * BFS 从保留格向新暴露土壤格传播温度衰减。
 * @param {FluidWorld} world 流体世界
 * @param {boolean[]} addedSolid 新暴露格掩码
 * @returns {void}
 */
const seedTempIntoAddedCells = (world, addedSolid) => {
	const W = world.worldW
	const queue = []
	for (let cell = 0; cell < addedSolid.length; cell++) {
		if (!addedSolid[cell]) continue
		const x = cell % W
		const y = (cell / W) | 0
		let best = T_AMB
		for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + ox
			const ny = y + oy
			if (!inWorld(world, nx, ny)) continue
			const neighbor = ny * W + nx
			if (addedSolid[neighbor]) continue
			best = Math.max(best, world.temp[neighbor], world.melt[neighbor] >= 0.05 ? world.temp[neighbor] : T_AMB)
		}
		if (best > T_AMB + 0.05) {
			world.temp[cell] = best * 0.85
			queue.push(cell)
		}
	}
	for (let qi = 0; qi < queue.length; qi++) {
		const cell = queue[qi]
		const x = cell % W
		const y = (cell / W) | 0
		const t0 = world.temp[cell]
		if (t0 < 0.2) continue
		const next = t0 * 0.7
		for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = x + ox
			const ny = y + oy
			if (!inWorld(world, nx, ny)) continue
			const neighbor = ny * W + nx
			if (!addedSolid[neighbor]) continue
			if (next > world.temp[neighbor] + 0.02) {
				world.temp[neighbor] = next
				queue.push(neighbor)
			}
		}
	}
}

/**
 * 围绕图标调整尺寸，保留既有地形/动力学，仅为新暴露区域生成地形。
 * @param {AnimState} state 动画状态
 * @param {{ width: number, height: number }} size 新视口尺寸
 * @returns {AnimState} 同一状态，原地 resize
 */
export const resizeAnimState = (state, { width, height }) => {
	width = Math.max(ICON_W, width)
	height = Math.max(ICON_H + 1, height)
	if (width === state.width && height === state.height) return state

	const old = state.world
	const newWorld = createWorld({ width, height, margin: VIEW_MARGIN, bottomExtra: BOTTOM_EXTRA })
	const { iconOx, iconOy } = iconOrigin(newWorld, width, height)
	const { terrain, addedSolid } = resizeTerrain(state.terrain, newWorld, {
		iconOx, iconOy, seed: state.seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X1,
	})

	const shiftX = iconOx - state.iconOx
	const shiftY = iconOy - state.iconOy

	for (let y = 0; y < old.worldH; y++)
		for (let x = 0; x < old.worldW; x++) {
			const oi = y * old.worldW + x
			const amt = old.liq[oi]
			const meltAmt = old.melt[oi]
			const moist = old.moisture[oi]
			const cond = old.condense[oi]
			const cellTemp = old.temp[oi]
			if (amt < 0.05 && meltAmt < 0.05 && moist < 0.02 && cond < 0.02 && cellTemp <= T_AMB + 0.02) continue
			const nx = (x + shiftX) | 0
			const ny = (y + shiftY) | 0
			if (!inWorld(newWorld, nx, ny)) continue
			if (amt >= 0.05 && !terrain.solid[ny * newWorld.worldW + nx])
				addLiquid(newWorld, nx, ny, amt)
			const ni = idx(newWorld, nx, ny)
			if (meltAmt >= 0.05)
				addMelt(newWorld, nx, ny, meltAmt, cellTemp)
			else if (cellTemp > T_AMB + 0.02)
				newWorld.temp[ni] = Math.max(newWorld.temp[ni], cellTemp)
			if ((moist > 0.02 || cond > 0.02) && terrain.solid[ny * newWorld.worldW + nx]) {
				newWorld.moisture[ni] = Math.min(SOIL_CAP, newWorld.moisture[ni] + moist)
				newWorld.condense[ni] += cond
				newWorld.temp[ni] = Math.max(newWorld.temp[ni], cellTemp)
			}
		}

	seedTempIntoAddedCells(newWorld, addedSolid)

	const src = old.particles
	for (let i = 0; i < src.count; i++) {
		const nx = src.x[i] + shiftX
		const ny = src.y[i] + shiftY
		if (nx < -2 || nx >= newWorld.worldW + 2) continue
		spawnParticle(newWorld, nx, ny, src.vx[i], src.vy[i], src.life[i], src.amt[i])
	}

	state.width = width
	state.height = height
	state.world = newWorld
	state.iconOx = iconOx
	state.iconOy = iconOy
	state.terrain = terrain
	state.matKey = -1
	state.frameCh = null
	state.frameFg = null
	rebuildMaterials(state)

	let hasAddedSoil = false
	for (let i = 0; i < addedSolid.length; i++) {
		if (!addedSolid[i] || (newWorld.mat[i] !== MAT.HORIZON && newWorld.mat[i] !== MAT.SOLID)) continue
		hasAddedSoil = true
		break
	}
	if (hasAddedSoil)
		stepResizeWeather(newWorld, RESIZE_WEATHER_TICKS)
	refreshLandGeometry(state)
	return state
}
