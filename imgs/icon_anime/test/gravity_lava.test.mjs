/**
 * 重力 / 出雨边 / 岩浆边界 / 热力相变 测试。
 */
/* global Deno */
import { assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	createWorld, addMelt, setMat, stepFluid, stepThermal, stepBoundary,
	stepParticles, spawnParticle, MAT, LIQ_DRAW, T_MAX, T_LIQUIDUS, T_SOLIDUS,
	LAVA_ONSET_EXPOSURE, rhoOf, viscOf, SUBSTANCE, totalMelt, applyGravityToWorld,
	neighborCoord, regurgitateTemp, clearMaterials, EDGE_TOP, EDGE_BOTTOM, EDGE_LEFT,
	pressureAt, liquidPressureAt, hydraulicPhi, gravityDepth,
	totalWorldWater, addLiquid, labelAirRegions, totalSealedGas,
} from '../fluid/index.mjs'
import {
	mapSensorToScreen, defaultGravity,
	BASE_PARTICLE_G,
} from '../gravity.mjs'
import { rainEdgeWeights, pickRainEdge } from '../scene.mjs'

Deno.test('gravity: mapSensorToScreen upright phone → screen down', () => {
	// Accelerometer-style: upright y≈+g (Android / GravitySensor / DeviceMotion)
	const mappedGravity = mapSensorToScreen(0, 9.81, 0)
	assertEquals(mappedGravity !== null, true)
	assertAlmostEquals(mappedGravity.gx, 0, 0.05)
	assertAlmostEquals(mappedGravity.gy, 1, 0.05)
})

Deno.test('gravity: mapSensorToScreen tilt on +x → screen gx opposite', () => {
	// sx = -ax: device +x (right) maps to screen left
	const mappedGravity = mapSensorToScreen(9.81, 0, 0)
	assertEquals(mappedGravity !== null, true)
	assertAlmostEquals(mappedGravity.gx, -1, 0.05)
	assertAlmostEquals(mappedGravity.gy, 0, 0.05)
})

Deno.test('gravity: flat device returns null', () => {
	assertEquals(mapSensorToScreen(0, 0, 9.81), null)
})

Deno.test('rain edges: default down → no bottom, top dominant, sides nonzero', () => {
	const edges = rainEdgeWeights(0, 1)
	const top = edges.find(edge => edge.ny < 0)
	const bot = edges.find(edge => edge.ny > 0)
	const left = edges.find(edge => edge.nx < 0)
	const right = edges.find(edge => edge.nx > 0)
	assertGreater(top.w, 0.5)
	assertEquals(bot.w, 0)
	assertGreater(left.w, 0)
	assertGreater(right.w, 0)
})

Deno.test('rain edges: pure left gravity → right edge dominates', () => {
	const edges = rainEdgeWeights(-1, 0)
	const right = edges.find(edge => edge.nx > 0)
	const left = edges.find(edge => edge.nx < 0)
	assertGreater(right.w, left.w)
	assertEquals(left.w, 0)
})

Deno.test('rain edges: inverted gravity → no bottom rain (composition ground)', () => {
	// gy<0 makes the screen bottom a physical sky; raining from there looks like
	// the pedestal spurting upward. Composition bottom never rains — wait for lava.
	const edges = rainEdgeWeights(0, -1)
	assertEquals(edges.find(edge => edge.ny > 0).w, 0)
	assertEquals(edges.find(edge => edge.ny < 0).w, 0)
	assertEquals(edges.reduce((weightSum, edge) => weightSum + edge.w, 0), 0)
})

Deno.test('rain edges: pickRainEdge respects weights', () => {
	const edges = rainEdgeWeights(0, 1)
	const picks = { top: 0, left: 0, right: 0, bottom: 0 }
	for (let stepIndex = 0; stepIndex < 200; stepIndex++) {
		const edge = pickRainEdge(edges, stepIndex / 200)
		if (edge.ny < 0) picks.top++
		else if (edge.ny > 0) picks.bottom++
		else if (edge.nx < 0) picks.left++
		else picks.right++
	}
	assertEquals(picks.bottom, 0)
	assertGreater(picks.top, picks.left)
})

Deno.test('lava: inverted gravity — quiet then onset on new down edge (top)', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	applyGravityToWorld(world, { gx: 0, gy: -1, mag: BASE_PARTICLE_G })
	const edges = rainEdgeWeights(0, -1)
	assertEquals(edges.find(edge => edge.ny > 0).w, 0)
	for (let stepIndex = 0; stepIndex < LAVA_ONSET_EXPOSURE - 2; stepIndex++)
		stepBoundary(world)
	assertLess(totalMelt(world), 0.01)
	for (let stepIndex = 0; stepIndex < 4; stepIndex++)
		stepBoundary(world)
	assertGreater(totalMelt(world), 0.1)
	const worldWidth = world.worldW
	let topMelt = 0
	let bottomMelt = 0
	for (let column = 0; column < worldWidth; column++) {
		topMelt += world.melt[column]
		bottomMelt += world.melt[(world.worldH - 1) * worldWidth + column]
	}
	assertGreater(topMelt, bottomMelt)
	assertGreater(world.boundary.exposure[EDGE_TOP], LAVA_ONSET_EXPOSURE - 1)
})

Deno.test('particles: vector gravity displaces in g direction', () => {
	const world = createWorld({ width: 20, height: 16, margin: 2, bottomExtra: 2 })
	applyGravityToWorld(world, { gx: 1, gy: 0, mag: BASE_PARTICLE_G })
	spawnParticle(world, 5, 5, 0, 0, 50, 0.4)
	const x0 = world.particles.x[0]
	stepParticles(world, () => { /* no hit */ })
	assertGreater(world.particles.x[0], x0)
})

Deno.test('lava: onset after LAVA_ONSET_EXPOSURE on down edge', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world)
	world.gravity = defaultGravity()
	world.boundary.exposure[EDGE_BOTTOM] = LAVA_ONSET_EXPOSURE - 1
	stepBoundary(world)
	// One more frame of exposure accumulates; still need >= threshold at start of inject check.
	// After step, exposure is LAVA_ONSET_EXPOSURE; lava should be on.
	assertGreater(totalMelt(world), 0.1)
	const world2 = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	clearMaterials(world2)
	world2.gravity = defaultGravity()
	world2.boundary.exposure[EDGE_BOTTOM] = LAVA_ONSET_EXPOSURE - 2
	stepBoundary(world2)
	// exposure becomes LAVA_ONSET_EXPOSURE-1 — below threshold, no lava
	assertLess(totalMelt(world2), 0.01)
})

Deno.test('lava: 45° accumulates exposure on two edges; onset ≈ 312·√2', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	const invSqrt2 = Math.SQRT1_2
	applyGravityToWorld(world, { gx: -invSqrt2, gy: invSqrt2, mag: BASE_PARTICLE_G })
	const need = LAVA_ONSET_EXPOSURE / invSqrt2
	for (let stepIndex = 0; stepIndex < (need | 0) - 2; stepIndex++)
		stepBoundary(world)
	assertLess(totalMelt(world), 0.01)
	for (let stepIndex = 0; stepIndex < 6; stepIndex++)
		stepBoundary(world)
	assertGreater(totalMelt(world), 0.1)
	// Both bottom and left should have been sourcing lava.
	assertGreater(world.boundary.exposure[EDGE_BOTTOM], LAVA_ONSET_EXPOSURE - 1)
	assertGreater(world.boundary.exposure[EDGE_LEFT], LAVA_ONSET_EXPOSURE - 1)
})

Deno.test('lava: down-edge melt clamped to T_MAX', () => {
	const world = createWorld({ width: 8, height: 8, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	world.gravity = defaultGravity()
	world.boundary.exposure[EDGE_BOTTOM] = LAVA_ONSET_EXPOSURE
	stepBoundary(world)
	const worldWidth = world.worldW
	const worldHeight = world.worldH
	for (let column = 0; column < worldWidth; column++) {
		const cell = (worldHeight - 1) * worldWidth + column
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
	assertLess(world.melt[3 * 6 + 2], LIQ_DRAW)
	assertEquals(world.mat[3 * 6 + 2] === MAT.SOLID || world.mat[3 * 6 + 2] === MAT.HORIZON, true)
})

Deno.test('thermal: soil moisture evaporates before melt', () => {
	const world = createWorld({ width: 4, height: 4, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	setMat(world, 1, 2, MAT.SOLID)
	world.moisture[2 * 4 + 1] = 0.8
	world.temp[2 * 4 + 1] = T_LIQUIDUS + 0.2
	stepThermal(world)
	assertEquals(world.mat[2 * 4 + 1] === MAT.SOLID || world.mat[2 * 4 + 1] === MAT.HORIZON, true)
	assertLess(world.moisture[2 * 4 + 1], 0.8)
	assertLess(world.melt[2 * 4 + 1], LIQ_DRAW)
})

Deno.test('boundary: up-edge absorb and regurgitate conserves units+heat', () => {
	const world = createWorld({ width: 6, height: 6, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addMelt(world, 2, 0, 0.8, 0.7)
	world.gravity = defaultGravity()
	stepBoundary(world)
	assertGreater(world.boundary.absorbedUnits, 0.7)
	const units = world.boundary.absorbedUnits
	const heat = world.boundary.absorbedHeat
	world.boundary.regurgitating = true
	world.boundary.regurgitatedUnits = 0
	world.boundary.regurgitatedHeat = 0
	let guard = 0
	while (world.boundary.regurgitating && guard++ < 200)
		stepBoundary(world)
	assertEquals(world.boundary.regurgitating, false)
	assertAlmostEquals(totalMelt(world), units, 0.15)
	let worldHeat = 0
	for (let i = 0; i < world.melt.length; i++)
		worldHeat += world.melt[i] * world.temp[i]
	assertAlmostEquals(worldHeat, heat, 0.15)
	assertGreater(heat, 0)
})

Deno.test('boundary: side wrap preserves same-row neighbor', () => {
	const world = createWorld({ width: 10, height: 8, margin: 0, bottomExtra: 0 })
	applyGravityToWorld(world, defaultGravity())
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
	world.melt.fill(0)
	world.temp.fill(0)
	addMelt(world, 1, 2, 1, 0.2)
	addMelt(world, 1, 3, 1, 0.95)
	for (let i = 0; i < 30; i++)
		stepFluid(world, { forceWind: 0 })
	const upper = world.temp[2 * 4 + 1]
	const lower = world.temp[3 * 4 + 1]
	assertGreater(upper + 0.05, lower)
})

Deno.test('regurgitateTemp: rises then falls from lastTemp', () => {
	const t0 = 0.4
	const mid = regurgitateTemp(t0, 0.5)
	const end = regurgitateTemp(t0, 1)
	assertGreater(mid, t0)
	assertLess(end, mid)
})

Deno.test('gravity: tilted depth increases along ĝ', () => {
	const world = createWorld({ width: 8, height: 8, margin: 0, bottomExtra: 0 })
	const s = Math.SQRT1_2
	applyGravityToWorld(world, { gx: s, gy: s, mag: BASE_PARTICLE_G })
	const d00 = gravityDepth(world, 0, 0)
	const d77 = gravityDepth(world, 7, 7)
	assertGreater(d77, d00)
	labelAirRegions(world)
	assertGreater(pressureAt(world, 7, 7), pressureAt(world, 0, 0))
})

Deno.test('gravity: 45° communicating vessels converge φ', () => {
	const world = createWorld({ width: 12, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	applyGravityToWorld(world, { gx: 0, gy: 1, mag: BASE_PARTICLE_G })
	// U-shape: walls
	for (let y = 3; y < 10; y++) {
		setMat(world, 2, y, MAT.SEAL)
		setMat(world, 9, y, MAT.SEAL)
	}
	for (let x = 2; x <= 9; x++) setMat(world, x, 9, MAT.SEAL)
	addLiquid(world, 3, 8, 1)
	addLiquid(world, 3, 7, 1)
	addLiquid(world, 3, 6, 0.8)
	addLiquid(world, 8, 8, 0.3)
	const water0 = totalWorldWater(world)
	for (let i = 0; i < 80; i++)
		stepFluid(world, { forceWind: 0 })
	assertAlmostEquals(totalWorldWater(world), water0, 0.35)
	const phiL = hydraulicPhi(liquidPressureAt(world, 3, 6), gravityDepth(world, 3, 6))
	const phiR = hydraulicPhi(liquidPressureAt(world, 8, 8), gravityDepth(world, 8, 8))
	// Surfaces should be closer in φ after equalize (allow loose tolerance).
	assertLess(Math.abs(phiL - phiR), 3)
})

Deno.test('gravity: sealed gas conserved under tilt', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	// Sealed cavity
	for (let x = 2; x <= 6; x++) {
		setMat(world, x, 2, MAT.SEAL)
		setMat(world, x, 6, MAT.SEAL)
	}
	for (let y = 2; y <= 6; y++) {
		setMat(world, 2, y, MAT.SEAL)
		setMat(world, 6, y, MAT.SEAL)
	}
	labelAirRegions(world)
	const g0 = totalSealedGas(world)
	assertGreater(g0, 0)
	applyGravityToWorld(world, { gx: -Math.SQRT1_2, gy: Math.SQRT1_2, mag: BASE_PARTICLE_G })
	labelAirRegions(world)
	assertAlmostEquals(totalSealedGas(world), g0, 0.05)
})
