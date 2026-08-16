import { console } from 'https://esm.sh/@steve02081504/virtual-console'

/** 浏览器默认虚拟控制台（全局代理）。 */
export const defaultConsole = console
/** 浏览器无 `process.stdin`。 */
export const defaultStdin = undefined
/** 浏览器全局 console 没有可用的 `_stdout` 流。 */
export const defaultStdout = undefined
