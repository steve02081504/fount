/**
 * 【文件】public/hub/index.mjs
 * 【职责】Chat Hub 前端入口：在加载子模块前应用主题，再串联事件绑定与初始化引导。
 * 【原理】wireBootstrap / initCore 同步尽快可用；wireEvents 与 init 异步加载重型模块图。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/theme、init、initCore、wireEvents、wireBootstrap
 */
import { applyTheme } from '../../../../scripts/theme.mjs'

import { wireBootstrap } from './wireBootstrap.mjs'

applyTheme()
wireBootstrap()
void import('./initCore.mjs').then(({ initCore }) => initCore())
void import('./wireEvents.mjs').then(({ wireEvents }) => wireEvents())
void import('./init.mjs').then(({ init }) => init())
