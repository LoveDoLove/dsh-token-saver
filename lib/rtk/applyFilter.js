/**
 * Safe filter runner: wrap filter execution so any thrown error or invalid
 * return value fails open (returns original text unmodified).
 * Ported from dsh-our-free-model / open-sse/rtk under MIT license.
 */
export function safeApply(fn, text) {
    try {
        const out = fn(text);
        if (typeof out !== 'string') {
            console.warn(`[RTK] filter ${fn.filterName || fn.name || 'anonymous'} returned non-string (${typeof out}); passing through`);
            return text;
        }
        return out;
    }
    catch (err) {
        console.warn(`[RTK] filter ${fn.filterName || fn.name || 'anonymous'} threw; passing through`, err);
        return text;
    }
}
