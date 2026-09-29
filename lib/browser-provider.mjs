export async function openBrowserSession(config) {
    const { createBrowserSession } = await import('./browser/registry.mjs');
    return createBrowserSession(config);
}
