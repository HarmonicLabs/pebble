import { extension, PATH_DELIMITER } from "../../common";

/**
 * Gets the directory part of a path
 */
function getDirectoryPath(path: string): string {
    const lastSlashIndex = path.lastIndexOf(PATH_DELIMITER);
    return lastSlashIndex >= 0 ? path.slice(0, lastSlashIndex + 1) : PATH_DELIMITER;
}

/**
 * Splits a path into segments
 */
function splitPath(path: string): string[] {
    return path.split(PATH_DELIMITER).filter(segment => segment !== '');
}

/**
 * Joins path segments into a normalized path
 */
function joinPath(segments: string[]): string {
    return segments.length > 0 ? PATH_DELIMITER + segments.join(PATH_DELIMITER) : PATH_DELIMITER;
}

function getPathExtension(path: string): string | undefined {
    const lastDotIndex = path.lastIndexOf('.');
    if (lastDotIndex === -1) {
        return undefined; // No extension found
    }
    const extension = path.slice(lastDotIndex).trimEnd();
    
    if (extension.includes(PATH_DELIMITER)) {
        return undefined; // Dot in the name of a directory
    }

    if (extension.length === 0 || extension === ".") return undefined;

    return extension;
}

/**
 * Adds extension if needed
 */
function addExtension(path: string, endsWithSlash: boolean): string {
    path = path.trim();
    
    // If path already has an extension, return it as is
    if (typeof getPathExtension(path) === "string") return path;
    
    // If the path ends with a slash or the original relative path ended with a slash,
    // append 'index' + extension
    if (path.endsWith(PATH_DELIMITER) || endsWithSlash) {
        // Ensure path ends with a slash
        if (!path.endsWith(PATH_DELIMITER)) {
            path += PATH_DELIMITER;
        }
        return path + 'index' + extension;
    }
    
    // Otherwise just add the extension
    return path + extension;
}

export function isAbsolutePath( path: string ): boolean
{
    // Support both Unix (/) and Windows (C:/, D:/) absolute paths
    return path.startsWith( PATH_DELIMITER ) || /^[A-Za-z]:[\\/]/.test( path );
}

export function getEnvRelativePath( filePath: string, projectRoot: string ): string | undefined
{
    if(!(
        typeof filePath === 'string' &&
        typeof projectRoot === 'string'
    )) return undefined;

    projectRoot = projectRoot.trim();
    if( !projectRoot.endsWith( PATH_DELIMITER ) ) projectRoot += PATH_DELIMITER;


    if( isAbsolutePath( filePath ) ) return filePath;

    filePath = getAbsolutePath( filePath.trim(), projectRoot )!;
    if( !filePath ) return undefined;

    return filePath.startsWith( projectRoot ) ? filePath : projectRoot + filePath;
}

/**
 * Takes a relative path and an absolute path, and returns the absolute path
 * corresponding to the relative path starting from the absolute path.
 * Returns undefined if the relative path goes beyond the root directory.
 * 
 * @example
 * getAbsolutePath("./c","/a/b.pebble") // returns "/a/c.pebble"
 * getAbsolutePath("../c","/a/b.pebble") // returns "/c.pebble"
 * getAbsolutePath("../../c", "/a/b.pebble") // returns undefined
 */
export function getAbsolutePath(relativePath: string, absolutePath: string): string | undefined {
    if (!absolutePath || typeof absolutePath !== 'string') {
        return undefined;
    }
    
    // Check if the relative path ends with a directory separator
    const endsWithSlash = relativePath.endsWith(PATH_DELIMITER) || relativePath.endsWith('./');
    
    // Get the directory containing the absolute path
    const baseDir = getDirectoryPath(absolutePath);
    
    // Split paths into segments
    const baseSegments = splitPath(baseDir);
    const relativeSegments = splitPath(relativePath);
    
    // Process relative path segments
    const resultSegments = [...baseSegments];
    
    for (const segment of relativeSegments) {
        if (segment === '.') {
            // Current directory - do nothing
            continue;
        } else if (segment === '..') {
            // Go up one directory
            if (resultSegments.length === 0) {
                // Attempting to go beyond root directory
                return undefined;
            }
            resultSegments.pop();
        } else {
            // Regular directory or file
            resultSegments.push(segment);
        }
    }
    
    // Join segments to form the result path
    let result = joinPath(resultSegments);
    
    // Add extension from the original file if needed
    result = addExtension(result, endsWithSlash);
    
    return result;
}