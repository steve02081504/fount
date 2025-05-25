// src/public/shells/shellassist/main.mjs
import { setEndpoints } from './src/server/endpoints.mjs';

let loading_count = 0; // Or manage as appropriate if shellassist has other async ops

export default {
    info: {
        '': { // Default language
            name: 'shellassist',
            avatar: '', // Add an appropriate avatar if available
            description: 'Interactive terminal access within fount.',
            description_markdown: 'Provides an interactive terminal connected to the fount server environment.',
            version: '1.0.0',
            author: 'fount-dev', // Or your name/handle
            homepage: '',
            tags: ['terminal', 'shell', 'interactive']
        }
    },
    Load: ({ router, wssRouter }) => { // Changed httpServer to wssRouter
        loading_count++;
        setEndpoints(router, wssRouter); // Pass wssRouter
        console.log('shellassist loaded.');
    },
    Unload: () => {
        loading_count--;
        // Add any cleanup logic if necessary
        console.log('shellassist unloaded.');
    },
    interfaces: {
        // Add any invoke interfaces if shellassist needs them
    }
};
