import { registerBrowserConformanceTests } from './browser-conformance.mjs';
import { createTestBrowserSession } from './helpers/playwright-test-session.mjs';

registerBrowserConformanceTests('playwright', async () => createTestBrowserSession());
