import http from 'node:http';
import { createPlaywrightBrowserSession } from '../../lib/browser/playwright-driver.mjs';

export async function createTestBrowserSession() {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<label for="name">客户名称</label><input id="name"><button>保存</button>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}/`;
    const session = createPlaywrightBrowserSession({ headless: true });
    const start = session.start.bind(session);
    const close = session.close.bind(session);
    return {
        ...session,
        conformanceBaseUrl: origin,
        async start() {
            await start();
            await session.navigate(origin);
        },
        async close() {
            await close();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
