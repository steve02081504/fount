/**
 * Pure tests: terrain generation (Terraria-style surface + caves).
 */
/* global Deno */
import { assert, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import { createWorld } from '../fluid_engine.mjs'
import {
	analyzeTerrain, generateTerrain, surfacePeriodicityScore, outlineChar, TERRAIN_CH,
} from '../terrain.mjs'

const ICON_BASE_ROWS = [16, 18, 20, 22]
const ICON_BASE_X0 = 5
const ICON_BASE_X1 = 37

/**
 * Build sample terrain for tests.
 * @param {number} [seed] RNG seed
 * @param {number} [width] view width
 * @param {number} [height] view height
 * @returns {ReturnType<typeof generateTerrain>} terrain
 */
const makeTerrain = (seed = 42, width = 80, height = 40) => {
	const world = createWorld({ width, height, margin: 12, bottomExtra: 4 })
	const iconOx = world.ox + Math.floor((width - 42) / 2)
	const iconOy = Math.floor((height - 23) / 2)
	return generateTerrain(world, {
		iconOx, iconOy, seed,
		iconBaseRows: ICON_BASE_ROWS,
		iconBaseX0: ICON_BASE_X0,
		iconBaseX1: ICON_BASE_X1,
	})
}

Deno.test('terrain: fixed seed is deterministic', () => {
	const a = makeTerrain(12345)
	const b = makeTerrain(12345)
	assertEquals([...a.surface], [...b.surface])
	assertEquals(a.features.length, b.features.length)
})

Deno.test('terrain: surface uses slope/wall/flat glyphs, not only bar', () => {
	const t = makeTerrain(7)
	const set = new Set(t.surfaceChar)
	const allowed = new Set(Object.values(TERRAIN_CH))
	for (const ch of set) assert(allowed.has(ch), `unexpected surface char ${ch}`)
	assert(set.has(TERRAIN_CH.FLAT) || set.has(TERRAIN_CH.FLAT_ALT))
	// expect some non-flat variation on a wide world
	assertGreater(set.size, 1)
})

Deno.test('terrain: surface is not highly periodic (not a sine)', () => {
	const t = makeTerrain(99, 120, 40)
	const score = surfacePeriodicityScore(t.surface)
	assertLess(score, 0.85)
})

Deno.test('terrain: injects U-tube and chamber features with cavities', () => {
	const t = makeTerrain(2024, 100, 45)
	const info = analyzeTerrain(t)
	assert(info.hasUTube, 'expected U-tube feature')
	assert(info.hasChamber, 'expected chamber/neck feature')
	assertGreater(info.count, 0)
	assertGreater(info.sizes[0] ?? 0, 4)
})

Deno.test('terrain: outlineChar marks cave walls', () => {
	const solid = [
		new Uint8Array([1, 1, 1, 1]),
		new Uint8Array([1, 0, 0, 1]),
		new Uint8Array([1, 0, 0, 1]),
		new Uint8Array([1, 1, 1, 1]),
	]
	const surface = new Int16Array([0, 0, 0, 0])
	const ch = outlineChar(solid, 0, 1, 4, 4, surface)
	assertEquals(ch, TERRAIN_CH.WALL)
	assertEquals(outlineChar(solid, 1, 1, 4, 4, surface), null)
})
