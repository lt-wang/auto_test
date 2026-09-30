import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { BrowserContractError, toPublicSnapshot } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import { executePlaywrightCommand } from './playwright-actions.mjs';
import { waitForPlaywrightCondition } from './playwright-conditions.mjs';
import { attachPlaywrightEvents } from './playwright-events.mjs';
import { waitForReady } from './playwright-readiness.mjs';
import { installRuntimeInstrumentation } from './runtime-instrumentation.mjs';

export function createPlaywrightBrowserSession(config = {}, dependencies = {}) {
    const chromiumImpl = dependencies.chromium || chromium;
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
            runtimeInstrumentation: true,
        },
        async start() {
            if (started)
                throw new BrowserContractError(
                    'browser-startup',
                    'Browser session already started',
                );
            const options = { headless: Boolean(config.headless) };
            if (config.browserChannel) options.channel = config.browserChannel;
            try {
                if (config.cdpUrl) {
                    browser = await chromiumImpl.connectOverCDP(config.cdpUrl);
                    context = browser.contexts()[0] || (await browser.newContext());
                    page = context.pages()[0] || (await context.newPage());
                } else {
                    browser = await chromiumImpl.launch(options);
                    context = await browser.newContext({
                        viewport: { width: 1500, height: 980 },
                        locale: 'zh-CN',
                        acceptDownloads: true,
                    });
                    page = await context.newPage();
                }
                page.setDefaultTimeout(9000);
                await page.addInitScript(installRuntimeInstrumentation);
                eventHub = attachPlaywrightEvents(page, context);
                started = true;
            } catch (error) {
                await context?.close().catch(() => {});
                await browser?.close().catch(() => {});
                browser = undefined;
                context = undefined;
                page = undefined;
                eventHub = undefined;
                refs = new Map();
                started = false;
                const failure = new BrowserContractError(
                    'browser-startup',
                    `Could not start browser: ${error.message}`,
                );
                failure.cause = error;
                throw failure;
            }
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
        async waitForReady(options = {}) {
            return waitForReady(requirePage(), options);
        },
        async settle(ms = 250) {
            const current = requirePage();
            await current.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            await current.waitForTimeout(ms);
            await current
                .locator(
                    '[aria-busy="true"]:visible,.ant-spin-spinning:visible,.el-loading-mask:visible,.mantine-LoadingOverlay-root:visible',
                )
                .first()
                .waitFor({ state: 'hidden', timeout: 5000 })
                .catch(() => {});
        },
        async snapshot(options = {}) {
            const raw = await snapshotPlaywrightPage(requirePage(), options);
            refs = new Map(raw.controls.map((control) => [control.ref, control]));
            return toPublicSnapshot(raw);
        },
        async discoverLabels(options = {}) {
            const current = requirePage();
            const raw = await snapshotPlaywrightPage(current);
            const max = Math.min(Number(options.limit || 40), 100);
            const targets = raw.controls
                .filter((control) => !options.rowKey || control.rowKey === options.rowKey)
                .filter((control) => control.nameSource === 'synthetic')
                .filter((control) => ['button', 'link', 'menuitem', 'tab'].includes(control.role))
                .slice(0, max);

            for (const control of targets) {
                const frame = current.frames()[control.frameIndex];
                if (!frame) continue;
                const locator = frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
                try {
                    await locator.hover({ timeout: 1500 });
                    await current.waitForTimeout(120);
                    const tips = frame.locator(
                        '[role="tooltip"]:visible,.mantine-Tooltip-tooltip:visible',
                    );
                    const labels = [
                        ...new Set(
                            (await tips.allTextContents())
                                .map((text) => text.trim())
                                .filter(Boolean),
                        ),
                    ];
                    if (labels.length === 1 && labels[0].length <= 100) {
                        await locator.evaluate(
                            (element, label) =>
                                element.setAttribute('data-laya-tooltip-label', label),
                            labels[0],
                        );
                    }
                } catch {}
                await current.mouse.move(0, 0);
            }
            return this.snapshot();
        },
        async act(command) {
            return executePlaywrightCommand(requirePage(), refs, command);
        },
        async waitFor(condition, options = {}) {
            return waitForPlaywrightCondition(requirePage(), condition, { ...options, refs });
        },
        async runtimeSnapshot() {
            return requirePage().evaluate(() => globalThis.__layaRuntime?.snapshot() || null);
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
