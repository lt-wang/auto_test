import { createPlaywrightBrowserSession } from '../lib/browser/playwright-driver.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const url = process.env.MANTINE_E2E_URL?.trim();
if (!url) {
    console.error(
        'MANTINE_E2E_URL is required, for example http://127.0.0.1:3001/modal-layout-harness.html',
    );
    process.exit(2);
}

const session = createPlaywrightBrowserSession({ headless: true });
let exitCode = 1;

try {
    await session.start();
    await session.navigate(url);
    await session.waitForReady({ timeout: 10000 }).catch(() => {});

    let snapshot;
    const deadline = Date.now() + 10000;
    do {
        snapshot = await session.snapshot();
        if (snapshot.modal?.role === 'dialog' && snapshot.modal.ariaModal === true) break;
        await sleep(250);
    } while (Date.now() < deadline);

    if (snapshot?.modal?.role !== 'dialog' || snapshot.modal.ariaModal !== true)
        throw new Error(
            `expected a visible role=dialog modal with aria-modal=true, got ${JSON.stringify(snapshot?.modal || null)}`,
        );

    const button = snapshot.controls.find(
        (control) =>
            control.layer === 'modal' &&
            control.role === 'button' &&
            control.adapter === 'mantine' &&
            control.component === 'button',
    );
    if (!button) throw new Error('expected at least one Mantine button inside the modal');

    console.log(
        JSON.stringify(
            {
                ok: true,
                url,
                backend: session.backend,
                modal: {
                    name: snapshot.modal.name,
                    role: snapshot.modal.role,
                    ariaModal: snapshot.modal.ariaModal,
                },
                button: {
                    name: button.name,
                    role: button.role,
                    component: button.component,
                    adapter: button.adapter,
                },
            },
            null,
            2,
        ),
    );
    exitCode = 0;
} catch (error) {
    console.error(`real Mantine smoke failed: ${error.message}`);
} finally {
    await session.close().catch(() => {});
    process.exitCode = exitCode;
}
