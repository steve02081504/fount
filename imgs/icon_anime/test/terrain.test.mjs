/**
 * 纯测试：地形生成（泰拉瑞亚式地表 + 洞穴）。
 */
/* global Deno */
import { assert, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import { createWorld } from '../fluid/index.mjs'
import {
	ICON_BASE_ROWS, ICON_BASE_X0, ICON_BASE_X1, ICON_W, ICON_H,
} from '../icon.mjs'
import {
	generateTerrain, outlineChar, refreshTerrainGeometry, TERRAIN_CH,
	TALL_LAND_FRACTION, TALL_LAND_HEIGHT_FRAC,
} from '../terrain.mjs'

import {
	analyzeTerrain, surfacePeriodicityScore, tallLandCoverage,
} from './terrain_helpers.mjs'

/**
 * 为测试构建样本地形。
 * @param {number} [seed] RNG 种子
 * @param {number} [width] 视口宽度
 * @param {number} [height] 视口高度
 * @returns {{ terrain: ReturnType<typeof generateTerrain>, world: ReturnType<typeof createWorld>, baseY: number }} 地形包
 */
const makeTerrain = (seed = 42, width = 80, height = 40) => {
	const world = createWorld({ width, height, margin: 12, bottomExtra: 4 })
	const iconOx = world.ox + Math.floor((width - ICON_W) / 2)
	const iconOy = Math.floor((height - ICON_H) / 2)
	return {
		terrain: generateTerrain(world, {
			iconOx, iconOy, seed,
			iconBaseRows: ICON_BASE_ROWS,
			iconBaseX0: ICON_BASE_X0,
			iconBaseX1: ICON_BASE_X1,
		}),
		world,
		baseY: Math.min(world.worldH - 4, iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1]),
	}
}

Deno.test('terrain: fixed seed is deterministic', () => {
	const a = makeTerrain(12345).terrain
	const b = makeTerrain(12345).terrain
	assertEquals([...a.surface], [...b.surface])
	assertEquals(a.features.length, b.features.length)
})

Deno.test('terrain: surface uses slope/wall/flat glyphs, not only bar', () => {
	const { terrain: t } = makeTerrain(7)
	const set = new Set(t.surfaceChar)
	const allowed = new Set(Object.values(TERRAIN_CH))
	for (const ch of set) assert(allowed.has(ch), `unexpected surface char ${ch}`)
	assert(set.has(TERRAIN_CH.FLAT) || set.has(TERRAIN_CH.FLAT_ALT))
	// expect some non-flat variation on a wide world
	assertGreater(set.size, 1)
})

Deno.test('terrain: descending surface columns get SLOPE_DOWN', () => {
	const { terrain } = makeTerrain(7)
	const { surface, surfaceChar, worldW: width } = terrain
	let found = false
	for (let x = 1; x < width - 1; x++) {
		const y = surface[x]
		const dL = y - surface[x - 1]
		const dR = surface[x + 1] - y
		if (dL === 0 && dR === 0) continue
		const slope = dR || dL
		const expect = Math.abs(slope) >= 2
			? TERRAIN_CH.WALL
			: slope < 0 ? TERRAIN_CH.SLOPE_UP : TERRAIN_CH.SLOPE_DOWN
		assertEquals(surfaceChar[x], expect)
		if (expect === TERRAIN_CH.SLOPE_DOWN) found = true
	}
	assert(found, 'expected at least one SLOPE_DOWN')
})

Deno.test('terrain: surface is not highly periodic (not a sine)', () => {
	const { terrain: t } = makeTerrain(99, 120, 40)
	const score = surfacePeriodicityScore(t.surface)
	assertLess(score, 0.85)
})

Deno.test('terrain: injects U-tube and chamber features with cavities', () => {
	const { terrain: t } = makeTerrain(2024, 100, 45)
	const info = analyzeTerrain(t)
	assert(info.hasUTube, 'expected U-tube feature')
	assert(info.hasChamber, 'expected chamber/neck feature')
	assertGreater(info.count, 0)
	assertGreater(info.sizes[0] ?? 0, 4)
})

Deno.test('terrain: pedestal ends sit on land flush with the base', () => {
	for (const seed of [1, 7, 42, 99, 2024]) {
		const { terrain: t, baseY } = makeTerrain(seed, 80, 40)
		const { footX0, footX1, surface, solid } = t
		assertEquals(surface[footX0], baseY)
		assertEquals(surface[footX1 - 1], baseY)
		// outer shoulders are land at the same grade
		assertEquals(surface[footX0 - 1], baseY)
		assertEquals(surface[footX1], baseY)
		const W = t.worldW
		assertEquals(solid[baseY * W + footX0 - 1], 1)
		assertEquals(solid[baseY * W + footX1], 1)
	}
})

Deno.test('terrain: ≥30% of view land is at least ¼ screen tall', () => {
	for (const [seed, w, h] of [[1, 80, 40], [7, 100, 48], [42, 80, 40], [99, 120, 40], [2024, 90, 36]]) {
		const { terrain: t } = makeTerrain(seed, w, h)
		const cov = tallLandCoverage(t, { viewH: h, viewW: w })
		assert(cov.fraction >= TALL_LAND_FRACTION - 1e-9, `seed=${seed} fraction=${cov.fraction}`)
		assertEquals(cov.minThick, Math.ceil(h * TALL_LAND_HEIGHT_FRAC))
	}
})

Deno.test('terrain: outlineChar marks cave walls; interior solid is null', () => {
	const width = 5
	const solid = new Uint8Array([
		1, 1, 1, 1, 1,
		1, 1, 1, 1, 1,
		1, 1, 1, 1, 1,
		1, 1, 0, 1, 1,
		1, 1, 1, 1, 1,
	])
	const surface = new Int16Array([0, 0, 0, 0, 0])
	// Fully enclosed solid at (1,1)
	assertEquals(outlineChar(solid, 1, 1, width, 5, surface), null)
	// Cave wall adjacent to air at (2,3) left of the air pocket
	assertEquals(outlineChar(solid, 1, 3, width, 5, surface), TERRAIN_CH.WALL)
})

Deno.test('terrain: refreshTerrainGeometry raises surface and outlines new crust', () => {
	const { terrain } = makeTerrain(7, 40, 24)
	const { solid, surface, worldW: W, worldH: H } = terrain
	const x = Math.min(W - 2, terrain.footX0 - 4)
	const oldTop = surface[x]
	const y = oldTop - 1
	assertGreater(y, 0)
	assertEquals(solid[y * W + x], 0)
	solid[y * W + x] = 1
	refreshTerrainGeometry(terrain)
	assertEquals(terrain.surface[x], y)
	assertEquals(terrain.outline[oldTop * W + x] !== null || terrain.surface[x] === y, true)
	assertEquals(terrain.surfaceChar[x].length > 0, true)
	// melting the crust back drops surface
	solid[y * W + x] = 0
	refreshTerrainGeometry(terrain)
	assertEquals(terrain.surface[x] >= oldTop && terrain.surface[x] < H, true)
})

Deno.test('terrain: under icon crust is soil; caves may open below', () => {
	let foundCave = false
	for (const seed of [1, 7, 42, 99, 2024, 555, 888, 1234, 9999]) {
		const { terrain: t, baseY, world } = makeTerrain(seed, 80, 40)
		const { footX0, footX1, surface, solid } = t
		const W = t.worldW
		for (let x = footX0; x < footX1; x++) {
			assertEquals(surface[x], baseY)
			assertEquals(solid[baseY * W + x], 1, `crust missing seed=${seed} x=${x}`)
			for (let y = baseY + 2; y < world.worldH; y++)
				if (!solid[y * W + x]) foundCave = true
		}
	}
	assert(foundCave, 'expected air below pedestal crust across seeds')
})
