/**
 * Compact line-numbered file reading output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import { READ_NUMBERED_MIN_HIT_RATIO, SMART_TRUNCATE_MIN_LINES, SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL } from '../constants.js';
const NUMBERED_LINE_RE = /^\s*(\d+)[:|]\s*(.*)$/;
export function isNumberedOutput(lines) {
    if (lines.length < SMART_TRUNCATE_MIN_LINES)
        return false;
    let numberedCount = 0;
    const sample = lines.slice(0, 50);
    for (const l of sample) {
        if (NUMBERED_LINE_RE.test(l))
            numberedCount++;
    }
    return numberedCount / sample.length >= READ_NUMBERED_MIN_HIT_RATIO;
}
export const readNumbered = function readNumbered(text) {
    const lines = text.split('\n');
    if (!isNumberedOutput(lines))
        return text;
    const head = lines.slice(0, SMART_TRUNCATE_HEAD);
    const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL);
    const omitted = lines.length - SMART_TRUNCATE_HEAD - SMART_TRUNCATE_TAIL;
    if (omitted <= 0)
        return text;
    return [
        ...head,
        `\n... [${omitted} numbered lines omitted to save tokens; head and tail preserved] ...\n`,
        ...tail,
    ].join('\n');
};
readNumbered.filterName = 'read-numbered';
