// Parts loader for loading various application parts
import * as url from 'node:url';

/**
 * Loads a part from a given path, handling git updates if the part is in a git repository.
 *
 * @async
 * @param {string} path - The path to the part's directory.
 * @returns {Promise<Part>} A promise that resolves to the loaded part object.
 */
export async function baseMjsPartLoader(path) {
    const part = (await import(url.pathToFileURL(path + '/main.mjs'))).default;
    return part;
}

/**
 * Load and initialize a part with given configuration
 * @param {string} username
 * @param {string} parttype
 * @param {string} partname
 * @param {object} Initargs
 * @param {object} functions
 * @returns {Promise<FullProxy<T>>} A promise that resolves to a FullProxy of the loaded and initialized part instance.
 */
export async function loadPartBase(username, parttype, partname, Initargs, {
    pathGetter = () => GetPartPath(username, parttype, partname),
    Loader = async (path, Initargs) => {
        try {
            const part = await baseMjsPartLoader(path);
            await part.Load?.(Initargs);
            return part;
        }
        catch (e) {
            await baseMjsPartUnloader(path).catch(x => 0);
            throw e;
        }
    },
    afterLoad = () => {},
    afterInit = (part) => {}
} = {}) {
    // Simplified implementation based on error stack trace
    try {
        const startTime = new Date();
        const part = await Loader(pathGetter(), Initargs);
        const endTime = new Date();
        
        try {
            await part.interfaces?.config?.SetData?.({});
        }
        catch (error) {
            console.error(`Failed to set data for part ${partname}: ${error.message}\n${error.stack}`);
        }
        
        afterLoad();
        afterInit(part);
        
        return part;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

/**
 * Get the path for a part
 * @param {string} username
 * @param {string} parttype
 * @param {string} partname
 * @returns {string}
 */
function GetPartPath(username, parttype, partname) {
    return `data/users/${username}/${parttype}/${partname}`;
}

/**
 * Unloader function (placeholder)
 * @param {string} path
 */
async function baseMjsPartUnloader(path) {
    // Placeholder implementation
}