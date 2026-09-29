import { BrowserContractError } from './contract.mjs';
import { createPlaywrightBrowserSession } from './playwright-driver.mjs';
import { createBrowserUseBrowserSession } from './browser-use-driver.mjs';

export async function createBrowserSession(config) {
    if (config.browserProvider === 'playwright') {
        const session = createPlaywrightBrowserSession(config);
        await session.start();
        return session;
    }
    if (config.browserProvider === 'browser-use') return createBrowserUseBrowserSession(config);
    throw new BrowserContractError(
        'unsupported-backend',
        `Unsupported browser provider: ${config.browserProvider}`,
    );
}
