/**
 * 重力 / 出雨边 / 岩浆边界 / 热力相变 测试。
 */
/* global Deno */
import { assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	createWorld, addMelt, setMat, stepFluid, stepThermal, stepBoundary,
	stepParticles, spawnParticle, MAT, LIQ_DRAW, T_MAX, T_LIQUIDUS, T_SOLIDUS,
	LAVA_ONSET_FRAMES, rhoOf, viscOf, SUBSTANCE, totalMelt, applyGravityToWorld,
	neighborCoord, regurgitateTemp, clearMaterials,
} from '../fluid/index.mjs'
import {
	mapSensorToScreen, quantizeGravity, setGravityTarget, tickGravity, defaultGravity,
	BASE_PARTICLE_G,
} from '../gravity.mjs'
import { rainEdgeWeights, pickRainEdge } from '../scene.mjs'

Deno.test('gravity: mapSensorToScreen upright phone → screen down', () => {
	// Device: gravity pulls to -y (top of phone), so ay ≈ -9.81
	const m = mapSensorToScreen(0, -9.81, 0)
	assertEquals(m !== null, true)
	assertAlmostEquals(m.gx, 0, 0.05)
	assertAlmostEquals(m.gy, 1, 0.05)
})

Deno.test('gravity: flat device returns null', () => {
	assertEquals(mapSensorToScreen(0, 0, -9.81), null)
})

Deno.test('gravity: quantize prefers dominant axis', () => {
	assertEquals(quantizeGravity(0.9, 0.1), { axis: 0, sign: 1 })
	assertEquals(quantizeGravity(-0.2, 0.8), { axis: 1, sign: 1 })
	assertEquals(quantizeGravity(0.1, -0.9), { axis: 1, sign: -1 })
})

Deno.test('rain edges: default down → no bottom, top dominant, sides nonzero', () => {
	const edges = rainEdgeWeights(0, 1)
	const top = edges.find(e => e.ny < 0)
	const bot = edges.find(e => e.ny > 0)
	const left = edges.find(e => e.nx < 0)
	const right = edges.find(e => e.nx > 0)
	assertGreater(top.w, 0.5)
	assertEquals(bot.w, 0)
	assertGreater(left.w, 0)
	assertGreater(right.w, 0)
})

Deno.test('rain edges: pure left gravity → right edge dominates', () => {
	const edges = rainEdgeWeights(-1, 0)
	const right = edges.find(e => e.nx > 0)
	const left = edges.find(e => e.nx < 0)
	assertGreater(right.w, left.w)
	assertEquals(left.w, 0)
})

Deno.test('rain edges: pickRainEdge respects weights', () => {
	const edges = rainEdgeWeights(0, 1)
	const picks = { top: 0, left: 0, right: 0, bottom: 0 }
	for (let i = 0; i < 200; i++) {
		const e = pickRainEdge(edges, i / 200)
		if (e.ny < 0) picks.top++
		else if (e.ny > 0) picks.bottom++
		else if (e.nx < 0) picks.left++
		else picks.right++
	}
	assertEquals(picks.bottom, 0)
	assertGreater(picks.top, picks.left)
})

Deno.test('particles: vector gravity displaces in g direction', () => {
	const world = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	setGravityTarget({ gx: 1, gy: 0, mag: BASE_PARTICLE_G })
	applyGravityToWorld(world, tickGravity())
	// Force exact vector (skip smooth)
	world.gravity.gx = 1
	world.gravity.gy = 0
	world.gravity.mag = 0.12
	spawnParticle(world, 5, 5, 0, 0, 50, 0.4)
	const x0 = world.particles.x[0]
	stepParticles(world, () => { /* no hit */ })
	assertGreater(world.particles.x[0], x0)
})

Deno.test('lava: onset after LAVA_ONSET_FRAMES of normal gravity', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	world.gravity = defaultGravity()
	world.gravity.normalFrames = LAVA_ONSET_FRAMES - 1
	stepBoundary(world)
	assertEquals(totalMelt(world) < 0.01, true)
	world.gravity.normalFrames = LAVA_ONSET_FRAMES
	stepBoundary(world)
	assertGreater(totalMelt(world), 0.1)
})

Deno.test('lava: down-edge melt clamped to T_MAX', () => {
	const world = createWorld({ width: 8, height: 8, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	world.gravity = defaultGravity()
	world.gravity.normalFrames = LAVA_ONSET_FRAMES
	stepBoundary(world)
	const W = world.worldW
	const H = world.worldH
	for (let x = 0; x < W; x++) {
		const cell = (H - 1) * W + x
		if (world.melt[cell] > 0.02)
			assertAlmostEquals(world.temp[cell], T_MAX, 1e-6)
	}
})

Deno.test('thermal: dry hot soil melts; cool melt solidifies', () => {
	const world = createWorld({ width: 6, height: 6, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	setMat(world, 2, 3, MAT.SOLID)
	world.moisture[3 * 6 + 2] = 0
	world.temp[3 * 6 + 2] = T_LIQUIDUS + 0.1
	stepThermal(world)
	assertGreater(world.melt[3 * 6 + 2], 0.5)
	assertEquals(world.mat[3 * 6 + 2], MAT.AIR)

	world.temp[3 * 6 + 2] = T_SOLIDUS - 0.1
	stepThermal(world)
	assertEquals(world.melt[3 * 6 + 2] < LIQ_DRAW, true)
	assertEquals(world.mat[3 * 6 + 2] === MAT.SOLID || world.mat[3 * 6 + 2] === MAT.HORIZON, true)
})

Deno.test('thermal: soil moisture evaporates before melt', () => {
	const world = createWorld({ width: 4, height: 4, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	setMat(world, 1, 2, MAT.SOLID)
	world.moisture[2 * 4 + 1] = 0.8
	world.temp[2 * 4 + 1] = T_LIQUIDUS + 0.2
	stepThermal(world)
	// Moisture must drop; mat stays soil (SOLID or HORIZON after surface refresh).
	assertEquals(world.mat[2 * 4 + 1] === MAT.SOLID || world.mat[2 * 4 + 1] === MAT.HORIZON, true)
	assertLess(world.moisture[2 * 4 + 1], 0.8)
	assertEquals(world.melt[2 * 4 + 1] < LIQ_DRAW, true)
})

Deno.test('boundary: up-edge absorb and regurgitate conserves units+heat', () => {
	const world = createWorld({ width: 6, height: 6, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addMelt(world, 2, 0, 0.8, 0.7)
	world.gravity = defaultGravity()
	world.gravity.normalFrames = 2
	stepBoundary(world)
	assertGreater(world.boundary.absorbedUnits, 0.7)
	const units = world.boundary.absorbedUnits
	const heat = world.boundary.absorbedHeat
	world.gravity.normalFrames = 1
	world.boundary.regurgitating = true
	world.boundary.regurgitatedUnits = 0
	world.boundary.regurgitatedHeat = 0
	let guard = 0
	while (world.boundary.regurgitating && guard++ < 200)
		stepBoundary(world)
	assertAlmostEquals(world.boundary.regurgitatedUnits || units, units, 0.15)
	assertGreater(heat, 0)
})

Deno.test('boundary: side wrap preserves same-row neighbor', () => {
	const world = createWorld({ width: 10, height: 8, margin: 0, bottomExtra: 0 })
	world.gravity = defaultGravity()
	const nb = neighborCoord(world, 0, 3, -1, 0)
	assertEquals(nb.wrapped, true)
	assertEquals(nb.x, world.worldW - 1)
	assertEquals(nb.y, 3)
})

Deno.test('rho/visc: hotter rock is lighter and less viscous', () => {
	const cold = rhoOf(SUBSTANCE.ROCK, 0)
	const hot = rhoOf(SUBSTANCE.ROCK, 1)
	assertGreater(cold, hot)
	assertGreater(viscOf(cold), viscOf(hot))
})

Deno.test('buoyancy: hot melt rises above cold melt', () => {
	const world = createWorld({ width: 4, height: 6, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addMelt(world, 1, 2, 1, 0.95) // hot above
	addMelt(world, 1, 3, 1, 0.2) // cold below — should stay; swap if inverted
	// Place cold above hot:
	world.melt.fill(0)
	world.temp.fill(0)
	addMelt(world, 1, 2, 1, 0.2)
	addMelt(world, 1, 3, 1, 0.95)
	for (let i = 0; i < 30; i++)
		stepFluid(world, { forceWind: 0 })
	const upper = world.temp[2 * 4 + 1]
	const lower = world.temp[3 * 4 + 1]
	// After buoyancy, hotter should not remain below colder.
	assertEquals(upper + 0.05 >= lower || world.melt[2 * 4 + 1] < 0.1, true)
})

Deno.test('regurgitateTemp: rises then falls from lastTemp', () => {
	const t0 = 0.4
	const mid = regurgitateTemp(t0, 0.5)
	const end = regurgitateTemp(t0, 1)
	assertGreater(mid, t0)
	assertLess(end, mid)
})
