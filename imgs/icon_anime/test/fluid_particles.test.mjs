/**
 * 纯测试：雨粒子、风抬升与涡旋。
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, stepGas, stepParticles, labelAirRegions, totalGridWater,
	totalWorldWater,
	clearMaterials, idx, LIQ_DRAW, spawnParticle, liftLiquidByWind, verticalGasDrag, GAS_DRAG, GAS_DRAG_Y, depositParticleMass,
} from '../fluid/index.mjs'

Deno.test('fluid: rain particles are dragged by local gas velocity', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	world.gasUx.fill(0.6)
	spawnParticle(world, 8, 2, 0, 0.4, 40, 0.5)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	for (let i = 0; i < 8; i++)
		stepParticles(world, hit)
	assert(world.particles.count > 0)
	assertGreater(world.particles.vx[0], 0.15)
})

Deno.test('fluid: vertical gas drag stays weak in calm air, strong in storms', () => {
	assertAlmostEquals(verticalGasDrag(0.1, 0.1), GAS_DRAG_Y)
	assertAlmostEquals(verticalGasDrag(3, 3), GAS_DRAG, 1e-9)
	assert(verticalGasDrag(1.2, 0) > GAS_DRAG_Y)
	assert(verticalGasDrag(1.2, 0) < GAS_DRAG)
})

Deno.test('fluid: tornado gas keeps rain orbiting aloft', async () => {
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const world = createWorld({ width: 28, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	const cx = world.ox + 14
	const cy = 8
	paintVortexDrive(cx, cy, 3.2, VORTEX_RADIUS, world, world.gasUx, world.gasUy)

	spawnParticle(world, cx + 4.2, cy, 0, 0.15, 90, 0.45)
	/** 空操作冲击回调（禁止落地）。 */
	const hit = () => { /* no-op — must not land */ }
	let angSpan = 0
	let prev = Math.atan2(world.particles.y[0] - cy, world.particles.x[0] - cx)
	let maxY = world.particles.y[0]
	for (let i = 0; i < 55; i++) {
		stepParticles(world, hit)
		assertGreater(world.particles.count, 0)
		const x = world.particles.x[0] - cx
		const y = world.particles.y[0] - cy
		maxY = Math.max(maxY, world.particles.y[0])
		const ang = Math.atan2(y, x)
		let d = ang - prev
		if (d > Math.PI) d -= Math.PI * 2
		if (d < -Math.PI) d += Math.PI * 2
		angSpan += d
		prev = ang
	}
	assertLess(maxY, cy + 5.5)
	assertGreater(angSpan, 1.2)
})

Deno.test('fluid: upward wind lifts free liquid into particles', () => {
	const world = createWorld({ width: 20, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 0; x < world.worldW; x++)
		setMat(world, x, 11, MAT.SEAL)
	const px = world.ox + 10
	const py = 10
	addLiquid(world, px, py, 0.95)
	const puddle = idx(world, px, py)
	const before = world.liq[puddle]
	assertGreater(before, LIQ_DRAW)
	// Wet cells block gas; suction is sampled from the air cell above.
	world.gasUy[idx(world, px, py - 1)] = -2.4
	world.gasUx[idx(world, px, py - 1)] = 0.8

	const lifted = liftLiquidByWind(world)
	assertGreater(lifted, 0.1)
	assertLess(world.liq[puddle], before)
	assertAlmostEquals(world.liq[puddle] + lifted, before, 1e-6)
	assertGreater(world.particles.count, 0)
	assertLess(world.particles.vy[0], -0.3)
	assertGreater(world.particles.amt[0], 0.1)
})

Deno.test('fluid: vortex drive through stepGas suspends rain', async () => {
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const { scratch } = await import('../fluid/world/index.mjs')
	const world = createWorld({ width: 28, height: 18, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'vUx', n, Float32Array)
	const driveUy = scratch(world, 'vUy', n, Float32Array)
	const cx = world.ox + 14
	const cy = 7
	paintVortexDrive(cx, cy, 3.3, VORTEX_RADIUS, world, driveUx, driveUy)
	for (let i = 0; i < 20; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0, driveUx, driveUy })

	assertLess(world.gasUy[idx(world, cx, cy)], -1.2)

	spawnParticle(world, cx + 3.5, cy + 1, 0, 0.3, 80, 0.4)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	let maxY = world.particles.y[0]
	for (let i = 0; i < 40; i++) {
		stepGas(world, { time: 20 + i, seed: 0, forceWind: 0, driveUx, driveUy })
		stepParticles(world, hit)
		if (!world.particles.count) break
		maxY = Math.max(maxY, world.particles.y[0])
	}
	assertGreater(world.particles.count, 0)
	assertLess(maxY, cy + 6)
})

Deno.test('fluid: vortex rain gathers at the cursor centre', async () => {
	// Tangential+inflow nulls ux on a diagonal; blanket updraft used to make that
	// corridor a hover attractor (upper-right of the cursor). Mean must stay near centre.
	const { paintVortexDrive, VORTEX_RADIUS } = await import('../gesture/wind.mjs')
	const { scratch } = await import('../fluid/world/index.mjs')
	const world = createWorld({ width: 36, height: 22, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	const n = world.worldW * world.worldH
	const driveUx = scratch(world, 'vUx', n, Float32Array)
	const driveUy = scratch(world, 'vUy', n, Float32Array)
	const cx = world.ox + 16.5
	const cy = 10.5
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }

	for (let i = 0; i < 36; i++) {
		const a = i / 36 * Math.PI * 2
		spawnParticle(world, cx + Math.cos(a) * 5, cy + Math.sin(a) * 3, 0, 0.15, 220, 0.35)
	}

	for (let t = 0; t < 90; t++) {
		driveUx.fill(0)
		driveUy.fill(0)
		paintVortexDrive(cx, cy, 3.3, VORTEX_RADIUS, world, driveUx, driveUy)
		stepGas(world, { time: t, seed: 0, forceWind: 0, driveUx, driveUy })
		stepParticles(world, hit)
	}

	assertGreater(world.particles.count, 8)
	let sx = 0
	let sy = 0
	for (let i = 0; i < world.particles.count; i++) {
		sx += world.particles.x[i]
		sy += world.particles.y[i]
	}
	const mx = sx / world.particles.count
	const my = sy / world.particles.count
	const dist = Math.hypot(mx - cx, my - cy)
	assertLess(dist, 2.2, `rain mean (${mx.toFixed(2)}, ${my.toFixed(2)}) drifted from cursor (${cx}, ${cy}) by ${dist.toFixed(2)}`)
	assertLess(Math.abs(mx - cx), 1.6)
	assertLess(Math.abs(my - cy), 1.6)
})

Deno.test('fluid: particle life expiry deposits mass into the grid', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 0; x < world.worldW; x++)
		setMat(world, x, 10, MAT.SEAL)
	spawnParticle(world, 8, 5, 0, 0, 1, 0.55)
	const before = totalWorldWater(world)
	assertAlmostEquals(before, 0.55, 1e-6)
	/** 空操作冲击回调。 */
	const hit = () => { /* no-op */ }
	stepParticles(world, hit)
	assertEquals(world.particles.count, 0)
	assertAlmostEquals(totalWorldWater(world), before, 1e-5)
	assertGreater(totalGridWater(world), 0.5)
})

Deno.test('fluid: particle deposit imparts liquid momentum', () => {
	const world = createWorld({ width: 12, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	depositParticleMass(world, 5, 5, 0.4, 0.8, -0.3)
	const i = idx(world, 5, 5)
	assertGreater(world.liq[i], 0.35)
	assertGreater(world.liqVx[i], 0.5)
	assertLess(world.liqVy[i], -0.1)
})
