/**
 * Prompt-cache strategy: stabilizes system prompt sections for prefix caching.
 * Ported from refs/dsh-token-saver under MIT license.
 */
export function stabilizeForCache(input) {
    const { sections, config } = input;
    if (config?.mode === 'off') {
        return { sections, cacheableRatio: 0, reordered: false };
    }
    const stableIds = new Set(config?.cacheStableSections ?? []);
    const originalOrder = sections.map((s) => s.id).join('|');
    const cacheable = sections.filter((s) => s.cacheable || stableIds.has(s.id));
    const volatile = sections.filter((s) => !(s.cacheable || stableIds.has(s.id)));
    const sortedCacheable = [...cacheable].sort((a, b) => {
        const aStable = stableIds.has(a.id) ? 0 : 1;
        const bStable = stableIds.has(b.id) ? 0 : 1;
        if (aStable !== bStable)
            return aStable - bStable;
        return a.position - b.position;
    });
    const reordered = [...sortedCacheable, ...volatile];
    const newOrder = reordered.map((s) => s.id).join('|');
    const cacheableRatio = sections.length > 0 ? sortedCacheable.length / sections.length : 0;
    return {
        sections: reordered,
        cacheableRatio,
        reordered: newOrder !== originalOrder,
    };
}
export function markCacheable(sections) {
    return sections;
}
export const __testing = { stabilizeForCache };
