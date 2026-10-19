/**
 * Compact find/fd output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import { FIND_PER_DIR_MAX, FIND_TOTAL_DIR_MAX } from '../constants.js';
export const find = function find(text, perDirMax = FIND_PER_DIR_MAX, totalDirMax = FIND_TOTAL_DIR_MAX) {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0)
        return text;
    const dirs = new Map();
    for (const line of lines) {
        const trimmed = line.trim();
        const lastSlash = trimmed.lastIndexOf('/');
        const dir = lastSlash === -1 ? '.' : trimmed.slice(0, lastSlash);
        const file = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
        let arr = dirs.get(dir);
        if (!arr) {
            arr = [];
            dirs.set(dir, arr);
        }
        arr.push(file);
    }
    const out = [];
    let dirCount = 0;
    let totalOmitted = 0;
    for (const [dir, files] of dirs) {
        if (dirCount >= totalDirMax) {
            totalOmitted += files.length;
            continue;
        }
        dirCount++;
        const shown = files.slice(0, perDirMax);
        const omitted = files.length - shown.length;
        totalOmitted += omitted;
        out.push(`${dir}/ (${files.length} file${files.length === 1 ? '' : 's'}):`);
        for (const f of shown) {
            out.push(`  ${f}`);
        }
        if (omitted > 0) {
            out.push(`  ... and ${omitted} more files`);
        }
    }
    const omittedDirs = dirs.size - dirCount;
    if (omittedDirs > 0 || totalOmitted > 0) {
        out.push(`\n[total: ${lines.length} files across ${dirs.size} directories, ${totalOmitted} omitted]`);
    }
    return out.join('\n');
};
find.filterName = 'find';
