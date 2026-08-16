/**
 * 冷启动等待页：入场动画播完后再按本机 fount 是否就绪跳转。
 */
import { setPreRender } from '../base.mjs'
import * as icon from '../imgs/icon_anime/session.mjs'
import { setTerminal } from '../scripts/components/terminal.mjs'
import { waitForFountService, saveFountHostUrl } from '../scripts/fountHostGetter.mjs'

try {
	navigator.serviceWorker?.controller?.postMessage({ type: 'ENTER_COLD_BOOT' })
} catch (error) {
	if (error.name != 'SecurityError') throw error
}

const hostUrl = 'http://localhost:8931'
const jumpTo = `${hostUrl}?cold_bootting=true`

setPreRender(jumpTo)
const ready = waitForFountService(hostUrl)

icon.setIO(setTerminal(document.getElementById('terminal')))

await icon.intro()
document.documentElement.dataset.iconIntro = 'done'
if (localStorage.getItem('fount_localhost_ping_passed') === 'true')
	window.location.href = jumpTo
else await ready
saveFountHostUrl(hostUrl)
localStorage.setItem('fount_localhost_ping_passed', true)
window.location.href = jumpTo
