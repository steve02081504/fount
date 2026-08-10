/**
 * 动画场景：状态、阶段、入场/保持/退场。
 */

/** 创建动画状态。 */
export { createAnimState } from './create.mjs'
/** 尺寸变化与天气 tick。 */
export { resizeAnimState, RESIZE_WEATHER_TICKS } from './resize.mjs'
/** 入场 / 保持 / 退场。 */
export { enter, hold, exit } from './stages.mjs'
