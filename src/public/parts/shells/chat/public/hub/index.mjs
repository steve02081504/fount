/**
 * 【文件】public/hub/index.mjs
 * 【职责】Chat Hub 前端入口：在加载子模块前应用主题，再串联事件绑定与初始化引导。
 * 【原理】不直接操作 DOM；通过 `wireEvents` 与 `init` 挂载整页 Hub 壳层（侧栏、主栏、输入区）。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/theme、init、wireEvents
 */
import { applyTheme } from '../../../../scripts/theme.mjs'

import { init } from './init.mjs'
import { wireEvents } from './wireEvents.mjs'

applyTheme()
wireEvents()
init()
