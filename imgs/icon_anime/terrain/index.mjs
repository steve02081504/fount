/**
 * 确定性 Terraria 风格 ASCII 地形与洞穴生成入口。
 * 土地占位写入 `world.land`（`terrain.solid` 同缓冲）。
 */

import {
	buildSurface, buildSurfaceChars, buildOutline, walkSurface,
} from './surface.mjs'
import {
	carveNoiseCaves, cellularCleanup, injectConnectors, carveIconFootprint,
	caveNoiseOpens,
} from './caves.mjs'

export {
	TERRAIN_CH, TALL_LAND_FRACTION, TALL_LAND_HEIGHT_FRAC,
	outlineChar, refreshTerrainGeometry,
} from './surface.mjs'
export { labelCavities } from './caves.mjs'

/**
 * @typedef {{
 *   surface: Int16Array,
 *   solid: Uint8Array,
 *   worldW: number,
 *   worldH: number,
 *   surfaceChar: string[],
 *   outline: (string | null)[],
 *   footX0: number,
 *   footX1: number,
 *   features: TerrainFeature[],
 *   viewW: number,
 *   ox: number,
 *   baseY: number,
 * }} TerrainData
 *
 * @typedef {{
 *   type: 'u_tube' | 'chamber' | 'neck',
 *   x0: number, x1: number, y0: number, y1: number,
 *   wells?: [number, number],
 * }} TerrainFeature
 */

/**
 * 为流体世界生成全宽地形。
 * @param {{ worldW: number, worldH: number, viewW: number, viewH: number, ox: number }} world 流体世界尺寸字段
 * @param {{ iconOx: number, iconOy: number, seed: number, iconBaseRows: number[], iconBaseX0: number, iconBaseX1: number }} opts 图标位置与种子
 * @returns {TerrainData} 地形数据
 */
export function generateTerrain(world, {
	iconOx, iconOy, seed,
	iconBaseRows, iconBaseX0, iconBaseX1,
}) {
	const { worldW: W, worldH: H, viewW, viewH, ox } = world
	const lastBase = iconBaseRows[iconBaseRows.length - 1]
	const baseY = Math.min(H - 4, iconOy + lastBase)
	const minY = Math.max(2, iconOy + 12)
	const maxY = H - 3
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1

	const surface = buildSurface(W, {
		baseY, minY, maxY, seed,
		footX0, footX1, viewH, viewW, ox, H,
	})

	const solid = world.land
	solid.fill(0)
	for (let x = 0; x < W; x++) {
		const top = surface[x]
		for (let y = top; y < H; y++)
			solid[y * W + x] = 1
	}

	carveNoiseCaves(solid, surface, W, H, seed, footX0, baseY)
	cellularCleanup(solid, surface, W, H, 2)

	const features = []
	injectConnectors(solid, surface, features, { W, H, seed, iconOx, iconBaseX0, iconBaseX1 })

	carveIconFootprint(solid, surface, W, H, footX0, footX1, baseY)

	const surfaceChar = buildSurfaceChars(surface, W)
	const outline = buildOutline(solid, surface, W, H)

	return {
		surface, solid, worldW: W, worldH: H, surfaceChar, outline,
		footX0, footX1, features, viewW, ox, baseY,
	}
}

/**
 * 缩放地形而不重生成仍留在世界内的格。
 * @param {TerrainData} previous 缩放前地形
 * @param {{ worldW: number, worldH: number, viewW: number, viewH: number, ox: number }} world 新流体世界
 * @param {{ iconOx: number, iconOy: number, seed: number, iconBaseRows: number[], iconBaseX0: number, iconBaseX1: number }} opts 图标位置与种子
 * @returns {{ terrain: TerrainData, addedSolid: Uint8Array }} 缩放后地形与新生成土壤掩码
 */
export function resizeTerrain(previous, world, opts) {
	const { worldW: W, worldH: H, viewW, ox } = world
	const { iconOx, iconOy, seed, iconBaseRows, iconBaseX0, iconBaseX1 } = opts
	const baseY = Math.min(H - 4, iconOy + iconBaseRows[iconBaseRows.length - 1])
	const footX0 = iconOx + iconBaseX0
	const footX1 = iconOx + iconBaseX1
	const dx = footX0 - previous.footX0
	const dy = baseY - previous.baseY
	const surface = new Int16Array(W)
	const solid = world.land
	solid.fill(0)
	const addedSolid = new Uint8Array(W * H)
	const minY = Math.max(2, iconOy + 12)
	const maxY = H - 3

	const retainedX0 = Math.max(0, dx)
	const retainedX1 = Math.min(W, dx + previous.worldW)
	for (let x = retainedX0; x < retainedX1; x++)
		surface[x] = Math.min(maxY, Math.max(minY, previous.surface[x - dx] + dy))
	if (retainedX0 > 0)
		walkSurface(surface, retainedX0 - 1, -1, surface[retainedX0], {
			minY, maxY, seed, hashOrigin: footX0,
		})
	if (retainedX1 < W)
		walkSurface(surface, retainedX1, 1, surface[retainedX1 - 1], {
			minY, maxY, seed, hashOrigin: footX0,
		})

	for (let y = 0; y < previous.worldH; y++) {
		const ny = y + dy
		if (ny < 0 || ny >= H) continue
		for (let x = 0; x < previous.worldW; x++) {
			const nx = x + dx
			if (nx < 0 || nx >= W) continue
			solid[ny * W + nx] = previous.solid[y * previous.worldW + x]
		}
	}

	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const oldX = x - dx
			const oldY = y - dy
			if (oldX >= 0 && oldX < previous.worldW && oldY >= 0 && oldY < previous.worldH)
				continue
			if (y < surface[x]) continue
			const i = y * W + x
			if (caveNoiseOpens(x, y, surface[x], footX0, baseY, seed)) continue
			solid[i] = 1
			addedSolid[i] = 1
		}

	const features = previous.features.flatMap(feature => {
		const x0 = feature.x0 + dx
		const x1 = feature.x1 + dx
		const y0 = feature.y0 + dy
		const y1 = feature.y1 + dy
		if (x1 <= 0 || x0 >= W || y1 <= 0 || y0 >= H) return []
		const shifted = { ...feature, x0, x1, y0, y1 }
		if (feature.wells)
			shifted.wells = /** @type {[number, number]} */ feature.wells.map(well => well + dx)
		return [shifted]
	})
	const terrain = {
		surface, solid, worldW: W, worldH: H,
		surfaceChar: buildSurfaceChars(surface, W),
		outline: buildOutline(solid, surface, W, H),
		footX0, footX1, features, viewW, ox, baseY,
	}
	return { terrain, addedSolid }
}
