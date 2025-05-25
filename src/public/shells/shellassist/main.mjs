import { setEndpoints } from './src/server/endpoints.mjs';

export default {
    info: {
        '': {
            name: 'shellassist',
            avatar: '',
            description: 'Interactive terminal access within fount.',
            description_markdown: 'Provides an interactive terminal connected to the fount server environment.',
            version: '1.0.0',
            author: 'steve02081504',
            homepage: '',
            tags: ['terminal', 'shell', 'interactive']
        }
    },
    Load: ({ router, wssRouter }) => {
        setEndpoints(router, wssRouter);
    },
    Unload: () => {},
    interfaces: {
    }
};
