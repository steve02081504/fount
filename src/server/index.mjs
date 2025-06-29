import { customConsole } from './console.mjs';
globalThis.console = customConsole;

// Rest of the index.mjs file would be here
console.log("Custom console initialized");