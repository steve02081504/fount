// src/public/shells/shellassist/src/server/endpoints.mjs
import { initTerminalWebsocket } from './terminal_ws.mjs';
// Import other necessary modules if shellassist has other HTTP endpoints

export function setEndpoints(router, wssRouter) { // Changed httpServer to wssRouter
    // Setup any regular HTTP routes for shellassist here, if needed
    // router.get('/api/shells/shellassist/some_data', authenticate, async (req, res) => { ... });

    // Initialize the WebSocket terminal server
    initTerminalWebsocket(wssRouter); // Pass wssRouter

    console.log('shellassist server endpoints configured.');
}
