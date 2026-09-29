export function createAdapterRegistry(adapters = []) {
    const ordered = [...adapters];

    return {
        register(adapter) {
            ordered.push(adapter);
            return adapter.id;
        },
        describe(element, context = {}) {
            for (const adapter of ordered) {
                if (!adapter.match(element, context)) continue;
                const descriptor = adapter.describe(element, context) || {};
                return { adapter: adapter.id, ...descriptor };
            }
            return null;
        },
    };
}
