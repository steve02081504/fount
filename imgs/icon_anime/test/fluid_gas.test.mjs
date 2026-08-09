/**
 * 纯测试：气相区域、压强、风场与伯努利。
 */
/* global Deno */
import { assert, assertAlmostEquals, assertEquals, assertGreater, assertLess } from 'jsr:@std/assert'

import {
	MAT, createWorld, setMat, addLiquid, stepLiquid, stepGas, labelAirRegions, pressureAt, totalSealedGas, P_ATM, ATM_HYDRO,
	clearMaterials, idx, RHO_G, RHO_AIR,
	addMelt, T_AMB, stepThermal,
	globalWindAt, windShear, gasVelocityAt, dynamicPressure,
	staticPressureAt, fillBlocked,
} from '../fluid/index.mjs'

import { sealedBox } from './fluid_helpers.mjs'

Deno.test('fluid: open atmosphere region has P_ATM', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	labelAirRegions(world)
	const open = world.regions.find(r => r?.openToAtm)
	assert(open)
	assertEquals(open.pressure, P_ATM)
	assertGreater(open.airCells, 0)
})

Deno.test('fluid: RHO_AIR matches ATM_HYDRO scale and stays below RHO_G', () => {
	assertLess(RHO_AIR, RHO_G * 0.1)
	assertAlmostEquals(RHO_AIR, ATM_HYDRO, 0.01)
})

Deno.test('fluid: sealed cavity distinct from atmosphere', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const sealed = world.regions.filter(r => r && !r.openToAtm)
	assertGreater(sealed.length, 0)
	const cell = idx(world, 7, 7)
	assertGreater(world.regionId[cell], 0)
	assert(!world.regions[world.regionId[cell]]?.openToAtm)
})

Deno.test('fluid: sealed cavity hydrostatic stratification around Boyle mean', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const sealed = world.regions.find(r => r && !r.openToAtm)
	assert(sealed)
	assertAlmostEquals(sealed.pressure, P_ATM, 1e-9)
	const yTop = 5
	const yBot = 9
	const pTop = pressureAt(world, 7, yTop)
	const pBot = pressureAt(world, 7, yBot)
	assertAlmostEquals(pBot - pTop, ATM_HYDRO * (yBot - yTop), 1e-9)
	assertAlmostEquals(pTop, sealed.pressure + ATM_HYDRO * (yTop - sealed.yMean), 1e-9)
	assertAlmostEquals(pBot, sealed.pressure + ATM_HYDRO * (yBot - sealed.yMean), 1e-9)
})

Deno.test('fluid: compressing sealed cavity raises pressure', () => {
	const world = sealedBox()
	labelAirRegions(world)
	const before = world.regions.find(r => r && !r.openToAtm)
	assert(before)
	const gas0 = before.gasAmount
	const cells0 = before.airCells

	// fill most of the cavity with liquid → shrink air volume
	for (let x = 5; x <= 9; x++)
		for (let y = 6; y <= 9; y++)
			addLiquid(world, x, y, 1)

	labelAirRegions(world)
	const after = world.regions.find(r => r && !r.openToAtm)
	assert(after)
	assertLess(after.airCells, cells0)
	assertGreater(after.pressure, P_ATM)
	// gas roughly conserved
	assertAlmostEquals(after.gasAmount, gas0, gas0 * 0.35 + 0.5)
})

Deno.test('fluid: total sealed gas conserved across a liquid step', () => {
	const world = sealedBox({ fillBottom: 2 })
	labelAirRegions(world)
	const g0 = totalSealedGas(world)
	stepLiquid(world)
	labelAirRegions(world)
	const g1 = totalSealedGas(world)
	assertAlmostEquals(g1, g0, Math.max(1, g0 * 0.25))
})

Deno.test('fluid: open-air pressure rises with depth', () => {
	const world = createWorld({ width: 16, height: 12, margin: 2, bottomExtra: 2 })
	labelAirRegions(world)
	const sky = pressureAt(world, 8, 1)
	const ground = pressureAt(world, 8, world.worldH - 3)
	assertAlmostEquals(sky, P_ATM + ATM_HYDRO * 1, 1e-9)
	assertGreater(ground, sky)
	assertAlmostEquals(ground - sky, ATM_HYDRO * ((world.worldH - 3) - 1), 1e-9)
})

Deno.test('fluid: pressureAt above open liquid follows air hydrostatic', () => {
	const world = createWorld({ width: 12, height: 10, margin: 1, bottomExtra: 1 })
	addLiquid(world, 5, 5, 1)
	labelAirRegions(world)
	assertAlmostEquals(pressureAt(world, 5, 4), P_ATM + ATM_HYDRO * 4, 1e-9)
})

Deno.test('fluid: global wind varies with time', () => {
	const samples = []
	for (let t = 0; t < 400; t += 5)
		samples.push(globalWindAt(t, 42))
	const min = Math.min(...samples)
	const max = Math.max(...samples)
	assertGreater(max - min, 0.2)
	assert(samples.some(v => v > 0))
	assert(samples.some(v => v < 0))
})

Deno.test('fluid: global wind is autocorrelated, not a sine stack', () => {
	const seed = 42
	const n = 120
	const xs = Array.from({ length: n }, (_, i) => globalWindAt(i, seed))
	// Nearby ticks stay correlated (real wind has persistence)
	let nearDot = 0, nearNormA = 0, nearNormB = 0
	for (let i = 0; i < n - 1; i++) {
		nearDot += xs[i] * xs[i + 1]
		nearNormA += xs[i] * xs[i]
		nearNormB += xs[i + 1] * xs[i + 1]
	}
	const nearCorr = nearDot / Math.sqrt(nearNormA * nearNormB)
	assertGreater(nearCorr, 0.85)

	// Lag-1 second differences are irregular — pure multi-sine is much smoother/periodic
	const secondDiffs = []
	for (let i = 1; i < n - 1; i++)
		secondDiffs.push(xs[i + 1] - 2 * xs[i] + xs[i - 1])
	const mean = secondDiffs.reduce((a, b) => a + b, 0) / secondDiffs.length
	const varD2 = secondDiffs.reduce((a, b) => a + (b - mean) ** 2, 0) / secondDiffs.length
	assertGreater(varD2, 1e-6)

	// Same seed is deterministic; different seed diverges
	assertEquals(globalWindAt(50, seed), globalWindAt(50, seed))
	assert(Math.abs(globalWindAt(50, seed) - globalWindAt(50, seed + 1)) > 1e-4)
})

Deno.test('fluid: wind shear is stronger aloft than near ground', () => {
	const H = 40
	const t = 20
	const seed = 7
	const depthSpan = H - 1
	const aloft = Math.abs(globalWindAt(t, seed) * windShear(2, depthSpan))
	const nearGround = Math.abs(globalWindAt(t, seed) * windShear(H - 3, depthSpan))
	assertGreater(aloft, nearGround)
	assertGreater(aloft / Math.max(1e-6, nearGround), 1.3)
})

Deno.test('fluid: open-air gas field follows forced wind with height shear', () => {
	const world = createWorld({ width: 24, height: 20, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	labelAirRegions(world)
	for (let i = 0; i < 40; i++)
		stepGas(world, { time: i, seed: 1, forceWind: 0.8 })
	const top = Math.abs(gasVelocityAt(world, 12, 2).ux)
	const bot = Math.abs(gasVelocityAt(world, 12, world.worldH - 3).ux)
	assertGreater(top, 0.15)
	assertGreater(top, bot)
})

Deno.test('fluid: wind-tunnel throat is faster than wide section (continuity)', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	// Horizontal duct: floor+ceiling, span 3 in the wide section
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	// Throat at x=16..18: only mid row open (span 1)
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}

	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	const wide = Math.abs(world.gasUx[idx(world, 10, 6)])
	const throat = Math.abs(world.gasUx[idx(world, 17, 6)])
	assertGreater(wide, 0.05)
	assertGreater(throat, wide * 1.15)
})

Deno.test('fluid: Bernoulli — higher speed carries higher dynamic pressure', () => {
	assertGreater(dynamicPressure(1.2), dynamicPressure(0.4))
	assertAlmostEquals(dynamicPressure(2, 0), 0.5 * RHO_AIR * 4, 1e-9)
})

Deno.test('fluid: Bernoulli — tunnel throat has lower static pressure', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}
	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	const pWide = staticPressureAt(world, 10, 6)
	const pThroat = staticPressureAt(world, 17, 6)
	assertLess(pThroat, pWide)
})

Deno.test('fluid: Bernoulli ΔP drive reinforces suction into the throat', () => {
	const world = createWorld({ width: 36, height: 16, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let x = 4; x <= 30; x++) {
		setMat(world, x, 4, MAT.SEAL)
		setMat(world, x, 8, MAT.SEAL)
	}
	for (let x = 16; x <= 18; x++) {
		setMat(world, x, 5, MAT.SEAL)
		setMat(world, x, 7, MAT.SEAL)
	}
	labelAirRegions(world)
	for (let i = 0; i < 50; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.9 })

	// Upstream of throat should feed into it (positive ux), and throat stays faster than wide.
	assertGreater(world.gasUx[idx(world, 14, 6)], 0.05)
	assertGreater(Math.abs(world.gasUx[idx(world, 17, 6)]), Math.abs(world.gasUx[idx(world, 10, 6)]) * 1.1)
})

Deno.test('fluid: flow stagnates against a solid face', () => {
	const world = createWorld({ width: 24, height: 14, margin: 2, bottomExtra: 2 })
	clearMaterials(world)
	for (let y = 2; y <= 10; y++)
		setMat(world, 14, y, MAT.SEAL)
	labelAirRegions(world)
	for (let i = 0; i < 35; i++)
		stepGas(world, { time: i, seed: 0, forceWind: 0.85 })
	const ahead = Math.abs(world.gasUx[idx(world, 13, 6)])
	const free = Math.abs(world.gasUx[idx(world, 8, 6)])
	assertGreater(free, 0.1)
	assertLess(ahead, free * 0.55)
})

Deno.test('fluid: gas projection reduces open-field divergence', () => {
	const world = createWorld({ width: 16, height: 14, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	// Solid frame so Neumann boundary can absorb flux (pure free expansion is not projectable).
	for (let x = 0; x < world.worldW; x++) {
		setMat(world, x, 0, MAT.SEAL)
		setMat(world, x, world.worldH - 1, MAT.SEAL)
	}
	for (let y = 0; y < world.worldH; y++) {
		setMat(world, 0, y, MAT.SEAL)
		setMat(world, world.worldW - 1, y, MAT.SEAL)
	}
	labelAirRegions(world)
	world.gasGeomDirty = true
	const { worldW: W, worldH: H } = world
	const n = W * H
	const cx = (W - 1) / 2
	const cy = (H - 1) / 2
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const cell = y * W + x
			const r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy)
			const amp = Math.exp(-r2 / 8)
			world.gasUx[cell] = (x - cx) * 0.45 * amp
			world.gasUy[cell] = (y - cy) * 0.45 * amp
		}
	/**
	 * @param {ReturnType<typeof createWorld>} w world
	 * @returns {number} mean |div|
	 */
	const meanAbsDiv = (w) => {
		const blocked = new Uint8Array(n)
		fillBlocked(w, blocked)
		let sum = 0
		let count = 0
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const cell = y * W + x
				if (blocked[cell]) continue
				const du = 0.5 * (w.gasUx[cell + 1] - w.gasUx[cell - 1])
					+ 0.5 * (w.gasUy[cell + W] - w.gasUy[cell - W])
				sum += Math.abs(du)
				count++
			}
		return count ? sum / count : 0
	}
	const before = meanAbsDiv(world)
	assertGreater(before, 0.05)
	stepGas(world, { time: 0, seed: 0, forceWind: 0, holdVelocity: true })
	const after = meanAbsDiv(world)
	assertLess(after, before * 0.85)
})

Deno.test('fluid: hot air column drives buoyant updraft vs cold', () => {
	const world = createWorld({ width: 12, height: 12, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	labelAirRegions(world)
	for (let y = 2; y <= 9; y++) {
		world.temp[idx(world, 3, y)] = 0.9
		world.temp[idx(world, 8, y)] = T_AMB
	}
	stepGas(world, { time: 0, seed: 0, forceWind: 0 })
	const hotAlong = world.gasUx[idx(world, 3, 5)] * world.gravity.gx
		+ world.gasUy[idx(world, 3, 5)] * world.gravity.gy
	const coldAlong = world.gasUx[idx(world, 8, 5)] * world.gravity.gx
		+ world.gasUy[idx(world, 8, 5)] * world.gravity.gy
	// Against gravity ⇒ more negative along ĝ for hot air.
	assertLess(hotAlong, coldAlong - 0.02)
})

Deno.test('fluid: steam flash heats neighboring air', () => {
	const world = createWorld({ width: 10, height: 10, margin: 0, bottomExtra: 0 })
	clearMaterials(world)
	addMelt(world, 4, 5, 1, 0.9)
	addLiquid(world, 4, 4, 0.8)
	// Place water onto melt cell to force flash.
	world.liq[idx(world, 4, 5)] = 0.5
	labelAirRegions(world)
	stepThermal(world)
	assertEquals(world.liq[idx(world, 4, 5)], 0)
	assertGreater(world.temp[idx(world, 4, 4)] + world.temp[idx(world, 4, 5)], T_AMB + 0.05)
})
