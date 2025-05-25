// src/server/wss_router.mjs
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser'; // Needed for auth adaptation

/**
 * @typedef {object} AuthenticatedUser - Represents the user object after authentication.
 * @property {string} username - The username.
 * // Add other user properties if available and needed by connection handlers
 */

/**
 * Callback for authenticating a WebSocket upgrade request.
 * @callback AuthCallback
 * @param {import('http').IncomingMessage} request - The HTTP upgrade request.
 * @param {(error: Error | null, user?: AuthenticatedUser) => void} callback - Called with error or authenticated user.
 */

/**
 * Callback for handling a new WebSocket connection after successful authentication and upgrade.
 * @callback ConnectionCallback
 * @param {import('ws').WebSocket} ws - The WebSocket connection instance.
 * @param {import('http').IncomingMessage} request - The original HTTP upgrade request.
 * @param {AuthenticatedUser} user - The authenticated user.
 */

/**
 * @typedef {object} WssRoute
 * @property {string} path - The WebSocket path (e.g., '/ws/terminal').
 * @property {AuthCallback} authCallback - Function to authenticate the request.
 * @property {ConnectionCallback} connectionCallback - Function to handle the WebSocket connection.
 * @property {WebSocketServer} wssInstance - A WebSocketServer instance specific to this path, created with noServer: true.
 */

export class WssRouter {
    /** @type {Map<string, WssRoute>} */
    routes = new Map();
    httpServer = null;

    /**
     * @param {import('http').Server | import('https').Server} httpServerInstance
     */
    constructor(httpServerInstance) {
        this.httpServer = httpServerInstance;
        this.httpServer.on('upgrade', this._handleUpgrade.bind(this));
        console.log('WssRouter initialized and attached to HTTP server upgrade event.');
    }

    /**
     * Registers a WebSocket endpoint.
     * @param {string} path - The path for the WebSocket endpoint.
     * @param {AuthCallback} authCallback - The authentication callback.
     * @param {ConnectionCallback} connectionCallback - The connection handling callback.
     */
    registerPath(path, authCallback, connectionCallback) {
        if (this.routes.has(path)) {
            console.warn(`WSS path ${path} already registered. Overwriting.`);
        }
        const wssInstance = new WebSocketServer({ noServer: true });

        // Attach the main connection callback to the specific wssInstance
        // The 'user' will be passed from the _handleUpgrade method after auth
        wssInstance.on('connection', (ws, request, user) => {
            // This is an intermediate step; the actual connectionCallback provided by the shell
            // is what should be called here.
            // The `user` here is critical.
            connectionCallback(ws, request, user);
        });
        
        this.routes.set(path, {
            path,
            authCallback,
            connectionCallback, // Storing this to potentially call directly if needed, though wssInstance.on('connection'...) is more standard
            wssInstance 
        });
        console.log(`WSS path ${path} registered.`);
    }

    /**
     * Handles the HTTP server's 'upgrade' event.
     * @private
     * @param {import('http').IncomingMessage} request
     * @param {import('stream').Duplex} socket
     * @param {Buffer} head
     */
    _handleUpgrade(request, socket, head) {
        const url = new URL(request.url, `ws://${request.headers.host}`);
        const route = this.routes.get(url.pathname);

        if (!route) {
            console.log(`No WSS handler for path ${url.pathname}. Destroying socket.`);
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        route.authCallback(request, (error, user) => {
            if (error || !user) {
                console.error(`WSS authentication failed for ${url.pathname}:`, error || 'User not authenticated');
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            // Proceed with WebSocket upgrade using the specific wssInstance for this route
            route.wssInstance.handleUpgrade(request, socket, head, (ws) => {
                // Pass the user object to the 'connection' event
                route.wssInstance.emit('connection', ws, request, user);
            });
        });
    }
}

/**
 * Helper function to adapt an Express-style authentication middleware for use as an AuthCallback.
 * This is specifically for the `expressAuthenticate` from `fount/src/server/auth.mjs`.
 * @param {Function} expressAuthMiddleware - The Express authentication middleware (e.g., from auth.mjs).
 * @returns {AuthCallback}
 */
export function adaptExpressAuthToWss(expressAuthMiddleware) {
    return (request, callback) => {
        const req = { // Mock Express request object
            headers: request.headers,
            cookies: {}, // Will be populated by cookieParser
            // Add other properties if expressAuthMiddleware depends on them (e.g., ip, originalUrl)
            ip: request.socket.remoteAddress, 
            originalUrl: request.url,
            url: request.url, // expressAuthenticate might use req.url
        };
        const res = { // Mock Express response object (only methods expressAuthMiddleware might call)
            cookie: (name, value, options) => { 
                console.warn(`WssAuthAdapter: expressAuthMiddleware tried to set cookie '${name}'. This is not typically sent back over WS upgrade.`);
            },
            clearCookie: (name, options) => {
                console.warn(`WssAuthAdapter: expressAuthMiddleware tried to clear cookie '${name}'.`);
            },
            status: (statusCode) => ({ 
                json: (body) => console.warn(`WssAuthAdapter: expressAuthMiddleware returned status ${statusCode} with body:`, body) 
            }),
            redirect: (path) => {
                console.warn(`WssAuthAdapter: expressAuthMiddleware tried to redirect to ${path}.`);
            }
        };
        const next = (err) => { // Mock Express next function
            if (err) {
                callback(err instanceof Error ? err : new Error(String(err)));
            } else {
                // If authentication is successful, req.user should be populated by expressAuthMiddleware
                callback(null, req.user); 
            }
        };

        // Manually invoke cookie parsing for the mocked req
        cookieParser()(req, /** @type {any} */ (res), () => {
            expressAuthMiddleware(req, /** @type {any} */ (res), next);
        });
    };
}
```
