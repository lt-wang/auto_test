import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BrowserContractError } from './contract.mjs';
import { createPlaywrightBrowserSession } from './playwright-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function startWorker(config) {
    const python = config.python;
    if (!python) throw new BrowserContractError('browser-startup', 'Python is required');
    const env = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        BROWSER_USE_HEADLESS: config.headless ? 'true' : 'false',
        ...(config.browserChannel ? { BROWSER_USE_CHANNEL: config.browserChannel } : {}),
    };
    const processHandle = spawn(python, ['-u', path.join(ROOT, 'browser_use_worker.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
    });
    processHandle.stderr.on('data', () => {});
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new BrowserContractError('browser-startup', 'browser-use start timeout')),
            120000,
        );
        readline.createInterface({ input: processHandle.stdout }).on('line', (line) => {
            try {
                const message = JSON.parse(line);
                if (message.ready) {
                    clearTimeout(timer);
                    resolve(message);
                }
            } catch {}
        });
        processHandle.on('error', reject);
        processHandle.on('exit', (code) => {
            clearTimeout(timer);
            reject(new BrowserContractError('browser-startup', `browser-use exited ${code}`));
        });
    });
    return { processHandle, ready };
}

export async function createBrowserUseBrowserSession(config) {
    const worker = startWorker(config);
    try {
        const ready = await worker.ready;
        const session = createPlaywrightBrowserSession({ ...config, cdpUrl: ready.cdp_url });
        await session.start();
        return {
            ...session,
            backend: 'browser-use',
            async close() {
                await session.close().catch(() => {});
                if (worker.processHandle.exitCode === null) {
                    worker.processHandle.stdin.write('{"action":"close"}\n');
                    await new Promise((resolve) => worker.processHandle.once('exit', resolve));
                }
            },
        };
    } catch (error) {
        worker.processHandle.kill();
        throw error;
    }
}
