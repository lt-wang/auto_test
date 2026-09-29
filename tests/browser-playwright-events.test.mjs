import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachPlaywrightEvents } from '../lib/browser/playwright-events.mjs';

test('events redact URLs and secrets', () => {
    const page = new EventEmitter();
    const context = new EventEmitter();
    context.pages = () => [page];
    const { events } = attachPlaywrightEvents(page, context);
    page.emit('console', {
        type: () => 'error',
        text: () => 'Bearer abc password=secret api_key=hidden',
    });
    assert.equal(events[0].kind, 'console');
    assert.ok(!events[0].detail.includes('abc'));
    assert.ok(!events[0].detail.includes('secret'));
    assert.ok(!events[0].detail.includes('hidden'));
});
