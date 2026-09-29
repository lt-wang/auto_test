import { registerBrowserConformanceTests } from './browser-conformance.mjs';
import { createFakeBrowserSession } from './fakes/fake-browser-driver.mjs';

registerBrowserConformanceTests('fake', async () => createFakeBrowserSession());
