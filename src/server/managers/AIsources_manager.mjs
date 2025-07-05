// AIsources manager - restored for character compatibility
// This manager handles AI source configurations and connections

/**
 * AI Sources Manager class
 */
export default class AIsourcesManager {
    constructor() {
        this.sources = new Map();
    }

    /**
     * Add an AI source
     * @param {string} name
     * @param {object} config
     */
    addSource(name, config) {
        this.sources.set(name, config);
    }

    /**
     * Get an AI source
     * @param {string} name
     * @returns {object|undefined}
     */
    getSource(name) {
        return this.sources.get(name);
    }

    /**
     * Remove an AI source
     * @param {string} name
     * @returns {boolean}
     */
    removeSource(name) {
        return this.sources.delete(name);
    }

    /**
     * List all sources
     * @returns {Array}
     */
    listSources() {
        return Array.from(this.sources.keys());
    }

    /**
     * Get source configurations
     * @returns {Array}
     */
    getConfigurations() {
        return Array.from(this.sources.entries()).map(([name, config]) => ({ name, config }));
    }
}

// Export singleton instance
export const aiSourcesManager = new AIsourcesManager();