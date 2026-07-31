/**
 * Pure tests: terrain generation (Terraria-style surface + caves).
 */
/* global Deno */
import { assert, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import { createWorld } from '../fluid/index.mjs'
import {
	analyzeTerrain, generateTerrain, surfacePeriodicityScore, outlineChar, TERRAIN_CH,
	tallLandCoverage, TALL_LAND_FRACTION, TALL_LAND_HEIGHT_FRAC,
} from '../terrain.mjs'

const ICON_BASE_ROWS = [16, 18, 20, 22]
const ICON_BASE_X0 = 5
const ICON_BASE_X1 = 37

/**
 * Build sample terrain for tests.
 * @param {number} [seed] RNG seed
 * @param {number} [width] view width
 * @param {number} [height] view height
 * @returns {{ terrain: ReturnType<typeof generateTerrain>, world: ReturnType<typeof createWorld>, iconOy: number, baseY: number }} bundle
 */
const makeTerrain = (seed = 42, width = 80, height = 40) => {
	const world = createWorld({ width, height, margin: 12, bottomExtra: 4 })
	const iconOx = world.ox + Math.floor((width - 42) / 2)
	const iconOy = Math.floor((height - 23) / 2)
	const terrain = generateTerrain(world, {
		iconOx, iconOy, seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X1,
	})
	const baseY = Math.min(world.worldH - 4, iconOy + ICON_BASE_ROWS[ICON_BASE_ROWS.length - 1])
	return { terrain, world, iconOy, baseY }
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

Deno.test('terrain: outlineChar marks cave walls', () => {
	const W = 4
	const solid = new Uint8Array([
		1, 1, 1, 1,
		1, 0, 0, 1,
		1, 0, 0, 1,
		1, 1, 1, 1,
	])
	const surface = new Int16Array([0, 0, 0, 0])
	const ch = outlineChar(solid, 0, 1, W, 4, surface)
	assertEquals(ch, TERRAIN_CH.WALL)
	assertEquals(outlineChar(solid, 1, 1, W, 4, surface), null)
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
