/**
 * Compact tree output.
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
import { TREE_MAX_LINES } from '../constants.js';
export const tree = function tree(text, maxLines = TREE_MAX_LINES) {
    const lines = text.split('\n');
    if (lines.length <= maxLines)
        return text;
    const head = lines.slice(0, maxLines);
    const omitted = lines.length - maxLines;
    head.push(`... (${omitted} tree lines omitted)`);
    return head.join('\n');
};
tree.filterName = 'tree';
