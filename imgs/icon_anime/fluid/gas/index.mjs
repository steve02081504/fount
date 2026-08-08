/**
 * 气区（Boyle）、全局风、气体速度场。
 * 调用方须在 `stepGas` / 压力查询前先执行 `labelAirRegions`。
 *
 * 开放空气：P = P_ATM + ATM_HYDRO·depth；密闭：等温 Boyle 均值 + ATM_HYDRO·(depth−depthMean)。
 * 速度：风切变 + 喷嘴连续性 + 邻格静压 ΔP（Bernoulli 反馈）+ 弱 Boussinesq。
 * 开放气在目标速度合成后做有限次 ∇·u≈0 投影；`driveUx/Uy` 超阈格回注以保留指针涡旋。
 */

/** @typedef {import('./regions.mjs').AirRegion} AirRegion */

/** 气区标注与空气格。 */
export {
	isAirCell, fillBlocked, labelAirRegions, totalSealedGas,
} from './regions.mjs'

/** 热力学 / 静压 / 动压。 */
export {
	ensureThermoPressure, pressureAt, dynamicPressure, staticPressureAt,
} from './pressure.mjs'

/** 风常量、速度采样与步进。 */
export {
	WIND_BASE, WIND_GUST, WIND_SHEAR_POWER, GAS_BLEND, GAS_NOZZLE, GAS_SPEED_MAX,
	globalWindAt, windShear, gasVelocityAt, gasUxAt, stepGas,
} from './velocity.mjs'
