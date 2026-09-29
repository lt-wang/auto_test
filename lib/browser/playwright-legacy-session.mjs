import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import { executePlaywrightCommand } from './playwright-actions.mjs';
import { waitForPlaywrightCondition } from './playwright-conditions.mjs';
import { waitForReady } from '../readiness.mjs';
import { safeText, safeUrl } from '../diagnostics.mjs';

export function normalizeBrowserSession(browser) {
    if (browser?.snapshot && browser?.act) return browser;
    const page = browser;
    let refs = new Map();
    return {
        backend: 'playwright',
        capabilities: {
            trace: false,
            pageErrors: false,
            consoleErrors: false,
            networkEvents: true,
            frames: true,
            shadowDom: true,
            downloads: false,
        },
        async start() {},
        async close() {},
        async navigate(url) {
            await page.goto?.(url, { waitUntil: 'domcontentloaded' });
        },
        async reload() {
            await page.reload?.({ waitUntil: 'domcontentloaded' });
        },
        async currentUrl() {
            return page.url?.() || '';
        },
        async snapshot(options = {}) {
            const snapshot = await snapshotPlaywrightPage(page, options);
            refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
            return snapshot;
        },
        async act(command) {
            return executePlaywrightCommand(page, refs, command);
        },
        async waitFor(condition, options = {}) {
            return waitForPlaywrightCondition(page, condition, options);
        },
        async waitForReady(options = {}) {
            return waitForReady(page, options);
        },
        async settle(ms = 250) {
            await page.waitForLoadState?.('domcontentloaded', { timeout: 5000 }).catch?.(() => {});
            await page.waitForTimeout?.(ms);
        },
        async screenshot(target, options = {}) {
            await page.screenshot?.({ path: target, ...options });
        },
        async startTrace() {},
        async stopTrace() {},
        onEvent(listener) {
            page.on?.('response', (response) => {
                if (response.status() < 400) return;
                listener({
                    time: new Date().toISOString(),
                    kind: 'http',
                    method: response.request?.().method?.() || '',
                    url: safeUrl(response.url()),
                    status: response.status(),
                    detail: safeText(response.statusText?.() || ''),
                });
            });
            return () => {};
        },
    };
}
