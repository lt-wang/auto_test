import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserContractError } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import { executePlaywrightCommand } from './playwright-actions.mjs';
import { waitForPlaywrightCondition } from './playwright-conditions.mjs';
import { attachPlaywrightEvents } from './playwright-events.mjs';

export function createPlaywrightBrowserSession(config = {}) {
    let browser;
    let context;
    let page;
    let eventHub;
    let tracePath = null;
    let refs = new Map();
    let started = false;

    const requirePage = () => {
        if (!started || !page)
            throw new BrowserContractError(
                'backend-disconnected',
                'Browser session is not started',
            );
        return page;
    };

    return {
        backend: 'playwright',
        capabilities: {
            trace: true,
            pageErrors: true,
            consoleErrors: true,
            networkEvents: true,
            frames: true,
            shadowDom: true,
            downloads: true,
        },
        async start() {
            if (started)
                throw new BrowserContractError(
                    'browser-startup',
                    'Browser session already started',
                );
            const options = { headless: Boolean(config.headless) };
            if (config.browserChannel) options.channel = config.browserChannel;
            browser = await chromium.launch(options);
            context = await browser.newContext({
                viewport: { width: 1500, height: 980 },
                locale: 'zh-CN',
                acceptDownloads: true,
            });
            page = await context.newPage();
            page.setDefaultTimeout(9000);
            eventHub = attachPlaywrightEvents(page, context);
            started = true;
        },
        async close() {
            started = false;
            await browser?.close().catch(() => {});
            browser = undefined;
            context = undefined;
            page = undefined;
            eventHub = undefined;
            refs = new Map();
        },
        async navigate(url) {
            await requirePage().goto(url, { waitUntil: 'domcontentloaded' });
        },
        async reload() {
            await requirePage().reload({ waitUntil: 'domcontentloaded' });
        },
        async currentUrl() {
            return requirePage().url();
        },
        async snapshot(options = {}) {
            const snapshot = await snapshotPlaywrightPage(requirePage(), options);
            refs = new Map(snapshot.controls.map((control) => [control.ref, control]));
            return snapshot;
        },
        async act(command) {
            return executePlaywrightCommand(requirePage(), refs, command);
        },
        async waitFor(condition, options = {}) {
            return waitForPlaywrightCondition(requirePage(), condition, options);
        },
        async screenshot(target, options = {}) {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await requirePage().screenshot({ path: target, ...options });
        },
        async startTrace(target) {
            if (!context)
                throw new BrowserContractError(
                    'backend-disconnected',
                    'Browser session is not started',
                );
            tracePath = target;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        },
        async stopTrace() {
            if (!context || !tracePath)
                throw new BrowserContractError('trace-failed', 'Trace was not started');
            const target = tracePath;
            tracePath = null;
            await context.tracing.stop({ path: target });
        },
        onEvent(listener) {
            if (!eventHub)
                throw new BrowserContractError(
                    'backend-disconnected',
                    'Browser session is not started',
                );
            return eventHub.subscribe(listener);
        },
    };
}
