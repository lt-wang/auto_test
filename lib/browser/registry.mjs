import { BrowserContractError } from './contract.mjs';
import { createPlaywrightBrowserSession } from './playwright-driver.mjs';

export async function createBrowserSession(config) {
    if (config.browserProvider !== 'playwright')
        throw new BrowserContractError(
            'unsupported-backend',
            `Unsupported browser provider: ${config.browserProvider}`,
        );
    const session = createPlaywrightBrowserSession(config);
    await session.start();
    return session;
}
