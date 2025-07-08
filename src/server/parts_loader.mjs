import fs from 'fs'

/**
 * A nice file write function that creates parent directories if needed
 */
function nicerWriteFileSync(filePath, data) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, data)
}

/**
 * Base function for loading parts with file system operations
 */
export function baseloadPart(username, parttype, partname, { pathGetter, Loader }) {
    const templatePath = pathGetter.getTemplatePath(parttype, partname)
    const userPath = pathGetter.getUserPath(username, parttype, partname)
    const path = userPath

    // Check if user directory exists, if not, copy from template
    if (!fs.existsSync(userPath)) {
        // Create the destination directory if it does not exist
        if (!fs.existsSync(userPath)) {
            fs.mkdirSync(userPath, { recursive: true })
        }

        function mapper(fileOrDir) {
            const sourcePath = templatePath + '/' + fileOrDir
            const destPath = userPath + '/' + fileOrDir
            
            if (fs.statSync(sourcePath).isDirectory()) {
                // Create the destination directory if it does not exist
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true })
                }
                // Correctly handle recursive directory copying by using the correct source path
                fs.readdirSync(sourcePath).forEach((path) => mapper(fileOrDir + '/' + path))
            }
            else {
                // Read the template file content before writing it to the destination
                const template = fs.readFileSync(sourcePath)
                nicerWriteFileSync(destPath, template)
            }
        }
        fs.readdirSync(templatePath).forEach(mapper)
    }
    
    return Promise.resolve(Loader(path)).catch((e) => {
        const parts_details_cache = loadData(username, 'parts_details_cache')
        if (parts_details_cache[parttype]?.[partname]) delete parts_details_cache[parttype][partname]
        saveData(username, 'parts_details_cache')
        throw e
    })
}

/**
 * Load part base function
 */
export function loadPartBase(username, parttype, partname, options) {
    // Implementation would go here - this is a placeholder
    return baseloadPart(username, parttype, partname, options)
}

// Placeholder functions that would be imported from other modules
function loadData(username, dataType) {
    return {}
}

function saveData(username, dataType) {
    // Implementation would go here
}