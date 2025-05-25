// src/public/shells/shellassist/src/public/shell_terminal_client.mjs
import { Terminal } from 'npm:xterm@^4.19.0'; // Check if this direct npm import works in fount's context for public scripts
                                          // Otherwise, assume xterm is globally available via <script> tag
import { FitAddon } from 'npm:xterm-addon-fit@^0.5.0'; // Same as above

export function initShellTerminal(elementId = 'shell-terminal') {
    const term = new Terminal({
        cursorBlink: true,
        convertEol: true // Ensure proper line endings
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const terminalElement = document.getElementById(elementId);
    if (!terminalElement) {
        console.error(`Terminal element with id '${elementId}' not found.`);
        return;
    }
    term.open(terminalElement);

    const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${socketProtocol}//${window.location.host}/ws/shellassist/terminal`;
    let socket;

    function connect() {
        socket = new WebSocket(socketUrl);

        socket.onopen = () => {
            console.log('WebSocket connection established for shell terminal.');
            term.writeln('Welcome to the fount interactive terminal!');
            // Initial fit and resize notification
            fitAddon.fit(); 
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'status') {
                    console.log('Status from server:', message.message);
                    term.writeln(`[SERVER STATUS] ${message.message}`);
                } else {
                    // Should not happen if server only sends raw data or specific status
                    term.write(event.data); 
                }
            } catch (e) {
                // If not JSON, assume it's raw terminal data
                term.write(event.data);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            term.writeln(`\r\n[CONNECTION ERROR] ${error.message || 'Connection failed.'}`);
        };

        socket.onclose = (event) => {
            console.log('WebSocket connection closed:', event);
            term.writeln(`\r\n[CONNECTION CLOSED] Code: ${event.code}, Reason: ${event.reason || 'No reason provided.'}`);
            // Optional: Attempt to reconnect after a delay
            // setTimeout(connect, 5000); 
        };
    }

    function sendSocketMessage(payload) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
        } else {
            console.warn('WebSocket not open. Message not sent:', payload);
            // term.writeln('[OFFLINE] Cannot send command.'); // Inform user
        }
    }

    term.onData(data => { // Handles user input, including paste
        sendSocketMessage({ type: 'data', data: data });
    });
    
    term.onResize(({ cols, rows }) => {
        console.log(`Terminal resized to ${cols} cols, ${rows} rows`);
        sendSocketMessage({ type: 'resize', data: { cols, rows } });
    });

    // Handle initial and window resize
    window.addEventListener('resize', () => {
        fitAddon.fit(); // This will trigger term.onResize if dimensions change
    });
    
    // Initial connection
    connect();
    
    // Expose term and socket for debugging or advanced interaction if needed
    // window.shellAssistTerminal = { term, socket, sendSocketMessage };

    console.log('Shell terminal client initialized.');
}

// Example of how this might be called from the shellassist HTML page:
// import { initShellTerminal } from './shell_terminal_client.mjs'; // If HTML uses type="module"
// document.addEventListener('DOMContentLoaded', () => {
//     initShellTerminal('shell-terminal-container-id'); 
// });
// Or, if not using modules in the HTML, this script could just run:
// initShellTerminal(); 
// Assuming xterm is loaded globally via a script tag if npm imports don't work directly in public scripts.
