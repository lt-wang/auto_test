import { safeText, safeUrl } from '../diagnostics.mjs';

export function attachPlaywrightEvents(page, context) {
    const events = [];
    const listeners = new Set();
    const add = (event) => {
        const saved = { time: new Date().toISOString(), ...event };
        events.push(saved);
        for (const listener of listeners) listener(saved);
        return saved;
    };
    const attachPage = (current) => {
        current.on('pageerror', (error) =>
            add({ kind: 'pageerror', detail: safeText(error.message) }),
        );
        current.on('console', (entry) => {
            if (entry.type() === 'error') add({ kind: 'console', detail: safeText(entry.text()) });
        });
        current.on('crash', () => add({ kind: 'crash', detail: '页面进程崩溃' }));
    };
    for (const current of context.pages()) attachPage(current);
    context.on('page', attachPage);
    context.on('requestfailed', (request) => {
        const detail = safeText(request.failure()?.errorText || '请求未完成');
        add({
            kind: /ERR_ABORTED|NS_BINDING_ABORTED/i.test(detail)
                ? 'requestcancelled'
                : 'requestfailed',
            method: request.method(),
            url: safeUrl(request.url()),
            detail,
        });
    });
    context.on('response', (response) => {
        if (response.status() < 400) return;
        add({
            kind: 'http',
            method: response.request().method(),
            url: safeUrl(response.url()),
            status: response.status(),
            detail: safeText(response.statusText()),
        });
    });
    return {
        events,
        subscribe(listener) {
            listeners.add(listener);
            for (const event of events) listener(event);
            return () => listeners.delete(listener);
        },
    };
}
