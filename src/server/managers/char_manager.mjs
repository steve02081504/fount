// Character manager
import { loadPartBase } from '../parts_loader.mjs';

/**
 * Load a character by username and charname
 * @param {string} username
 * @param {string} charname
 * @returns {Promise<import('../../decl/charAPI.ts').CharAPI_t>}
 */
export async function LoadChar(username, charname) {
    // Implementation based on the error stack trace
    const data = loadCharData(username, charname);
    const char_state = data.state;
    const char = await loadPartBase(username, 'chars', charname, {
        username,
        charname,
        state: char_state,
    }, {
        afterLoad: () => {
            char_state.last_start_time_stamp = Date.now();
            char_state.start_count++;
        }
    });
    return char;
}

function loadCharData(username, charname) {
    // Placeholder implementation
    return {
        state: {
            last_start_time_stamp: null,
            start_count: 0
        }
    };
}