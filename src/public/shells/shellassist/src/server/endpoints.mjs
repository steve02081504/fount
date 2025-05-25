import { initTerminalWebsocket } from './terminal_ws.mjs';

export function setEndpoints(router, wssRouter) {
    initTerminalWebsocket(wssRouter)
}
