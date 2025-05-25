// src/public/shells/shellassist/src/server/terminal_ws.mjs
import { authenticate as expressAuthenticate } from '../../../../../server/auth.mjs';
import os from 'os';
import pty from 'node-pty';
// adaptExpressAuthToWss is imported from wss_router.mjs
import { adaptExpressAuthToWss } from '../../../../../server/wss_router.mjs';
// WebSocketServer and cookieParser are no longer directly needed here.

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

function spawnShell() {
    return pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80, // Default, can be resized
        rows: 30, // Default, can be resized
        cwd: os.homedir(), // Use os.homedir() for better platform compatibility
        env: process.env,
    });
}

// This function is the authentication callback for WssRouter
// It uses adaptExpressAuthToWss which correctly transforms expressAuthenticate.
const authCallbackForTerminal = adaptExpressAuthToWss(expressAuthenticate);

// This function is the connection callback for WssRouter
function handleTerminalConnection(ws, request, user) {
    console.log(`WebSocket connection established for shellassist terminal, user: ${user.username}`);
    const ptyProcess = spawnShell();

    ws.on('message', (message) => {
        try {
            let inputData = '';
            if (typeof message === 'string') {
                inputData = message;
            } else if (Buffer.isBuffer(message)) {
                inputData = message.toString('utf-8');
            } else {
                console.warn('Received non-string/buffer WebSocket message:', message);
                return; // Ignore if not string or buffer
            }

            // Assuming client always sends JSON strings
            const parsedMessage = JSON.parse(inputData); 
            if (parsedMessage.type === 'resize' && parsedMessage.data &&
                typeof parsedMessage.data.cols === 'number' && typeof parsedMessage.data.rows === 'number') {
                ptyProcess.resize(parsedMessage.data.cols, parsedMessage.data.rows);
            } else if (parsedMessage.type === 'data' && typeof parsedMessage.data === 'string') {
                ptyProcess.write(parsedMessage.data);
            } else {
                console.warn('Received valid JSON but with unexpected type or missing data:', parsedMessage);
            }
        } catch (e) {
            // This catch block handles errors from JSON.parse if inputData is not valid JSON,
            // or if inputData was empty string (after toString from an empty buffer for example).
            // If client is expected to sometimes send non-JSON strings, that logic would go here.
            // For now, we assume client sends JSON or there's an error in format.
            console.error('Failed to parse client message as JSON, or error in processing:', e);
            // Optionally, if raw data strings were also supported for input:
            // if (typeof inputData === 'string' && inputData.length > 0) {
            //     ptyProcess.write(inputData); // Treat as raw input if JSON parse fails
            // }
        }
    });

    ptyProcess.on('data', (data) => {
        if (ws.readyState === ws.OPEN) { // Ensure WebSocket is still open before sending
            ws.send(data); // Send raw data from PTY to client
        }
    });

    ws.on('close', () => {
        console.log(`WebSocket connection closed for shellassist terminal, user: ${user.username}`);
        ptyProcess.kill();
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for shellassist terminal, user ${user.username}:`, error);
        ptyProcess.kill();
    });

    // Send initial status message
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'status', message: 'PTY session started via WssRouter' }));
    }
}

export function initTerminalWebsocket(wssRouter) { // Parameter changed to wssRouter
    const terminalPath = '/ws/shellassist/terminal';

    wssRouter.registerPath(
        terminalPath,
        authCallbackForTerminal,
        handleTerminalConnection
    );

    // The old direct httpServer.on('upgrade', ...) and wss.on('connection', ...) are removed.
    // WssRouter now handles the upgrade and auth, then calls handleTerminalConnection.

    console.log('ShellAssist WebSocket Terminal configured to use WssRouter.');
}
