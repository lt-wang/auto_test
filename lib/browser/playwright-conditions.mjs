import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { BrowserContractError, validateCondition } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';

const VISUAL_COLOR_TOLERANCE = 0.1;
const DEFAULT_VISUAL_DIFF_THRESHOLD = 0.1;

const visualArtifactPaths = (condition, options) => {
    const visualDir = path.resolve(options.visualDir || path.join(process.cwd(), 'runs', 'visual'));
    const baseline = path.basename(condition.baseline, path.extname(condition.baseline));
    const ref = condition.ref || 'page';
    const sanitize = (value) =>
        String(value)
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .slice(0, 80);
    const prefix = sanitize(`${baseline}-${ref}`);
    return {
        actual: path.join(visualDir, `${prefix}.actual.png`),
        expected: path.join(visualDir, `${prefix}.expected.png`),
        diff: path.join(visualDir, `${prefix}.diff.png`),
    };
};

const visualFailure = (message, elapsed, evidence) => {
    const error = new BrowserContractError(
        'wait-timeout',
        `${message}; changedRatio=${evidence.changedRatio.toFixed(6)}; score=${evidence.score.toFixed(6)}; expected=${evidence.artifacts.expected}; actual=${evidence.artifacts.actual}; diff=${evidence.artifacts.diff}`,
    );
    Object.assign(error, evidence);
    error.elapsed_ms = elapsed;
    return error;
};

const matchesQuery = (control, query) =>
    control.name === query.name &&
    (!query.role || control.role === query.role) &&
    (!query.rowKey || control.rowKey === query.rowKey) &&
    (query.index === undefined || control.index === query.index);

const uniqueMatch = (controls, query) => {
    const matches = controls.filter((control) => matchesQuery(control, query));
    if (matches.length > 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Control query matched ${matches.length} controls: ${query.name}`,
        );
    return matches[0] || null;
};

const visibleTextCount = async (page, value, scope = 'page') => {
    let count = 0;
    for (const frame of page.frames())
        count += await frame
            .evaluate(
                ({ value, scope }) => {
                    const visible = (element) => {
                        const style = getComputedStyle(element);
                        const rect = element.getBoundingClientRect();
                        return (
                            style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            rect.width > 0 &&
                            rect.height > 0 &&
                            !element.closest('[inert],[aria-hidden="true"]')
                        );
                    };
                    const text = (element) =>
                        (element?.innerText || element?.textContent || '')
                            .replace(/\s+/g, ' ')
                            .trim();
                    const modal = [
                        ...document.querySelectorAll(
                            'dialog[open],[role="dialog"],[role="alertdialog"],[data-slot="dialog-content"],[data-slot="alertdialog-content"],.ant-drawer-open .ant-drawer-content,.el-dialog',
                        ),
                    ]
                        .filter(visible)
                        .at(-1);
                    if (scope === 'modal' && !modal) return 0;
                    return [...document.querySelectorAll('body *')].filter((element) => {
                        if (!visible(element) || !text(element).includes(value)) return false;
                        if (scope === 'modal' && !modal.contains(element)) return false;
                        return ![...element.children].some(
                            (child) => visible(child) && text(child).includes(value),
                        );
                    }).length;
                },
                { value, scope },
            )
            .catch(() => 0);
    return count;
};

const formErrorTexts = async (page) => {
    const texts = [];
    for (const frame of page.frames()) {
        const locator = frame.locator(
            '[role="alert"]:visible,.ant-form-item-explain-error:visible,.el-form-item__error:visible,.mantine-InputWrapper-error:visible',
        );
        texts.push(...(await locator.allTextContents().catch(() => [])));
    }
    return texts.map((text) => text.replace(/\s+/g, ' ').trim());
};

export async function waitForPlaywrightCondition(page, rawCondition, options = {}) {
    const condition = validateCondition(rawCondition);
    const timeout = options.timeout ?? 4000;
    const interval = options.interval ?? 50;
    const start = Date.now();
    let lastVisualFailure = null;
    while (Date.now() - start <= timeout) {
        if (condition.kind === 'visualDiff') {
            const refControl = condition.ref ? options.refs?.get(condition.ref) : null;
            if (condition.ref && !refControl)
                throw new BrowserContractError('missing-ref', condition.ref);
            let locator = page;
            if (refControl) {
                const frame = page.frames()[refControl.frameIndex];
                if (!frame) throw new BrowserContractError('stale-ref', condition.ref);
                locator = frame.locator(`[data-laya-live-ref="${refControl.ref}"]`);
                const count = await locator.count();
                if (count === 0) throw new BrowserContractError('stale-ref', condition.ref);
                if (count !== 1)
                    throw new BrowserContractError(
                        'ambiguous-query',
                        `Visual ref matched ${count} elements: ${condition.ref}`,
                    );
            }
            const actual = await locator.screenshot({ animations: 'disabled' });
            const expected = await fs.readFile(condition.baseline);
            const actualPng = PNG.sync.read(actual);
            const expectedPng = PNG.sync.read(expected);
            const diff = new PNG({ width: actualPng.width, height: actualPng.height });
            const dimensionsMatch =
                actualPng.width === expectedPng.width && actualPng.height === expectedPng.height;
            const changed = dimensionsMatch
                ? pixelmatch(
                      expectedPng.data,
                      actualPng.data,
                      diff.data,
                      actualPng.width,
                      actualPng.height,
                      { threshold: VISUAL_COLOR_TOLERANCE },
                  )
                : actualPng.width * actualPng.height;
            if (!dimensionsMatch) diff.data.fill(255);
            const changedRatio = changed / (actualPng.width * actualPng.height || 1);
            const artifacts = visualArtifactPaths(condition, options);
            await fs.mkdir(path.dirname(artifacts.actual), { recursive: true });
            await fs.writeFile(artifacts.actual, actual);
            await fs.writeFile(artifacts.expected, expected);
            await fs.writeFile(artifacts.diff, PNG.sync.write(diff));
            const evidence = {
                changed,
                changedRatio,
                score: changedRatio,
                artifacts,
            };
            if (!dimensionsMatch)
                throw visualFailure('Visual dimensions differ', Date.now() - start, evidence);
            if (changedRatio <= (condition.threshold ?? DEFAULT_VISUAL_DIFF_THRESHOLD))
                return { matched: true, elapsed_ms: Date.now() - start, ...evidence };
            lastVisualFailure = visualFailure(
                'Visual diff exceeded threshold',
                Date.now() - start,
                evidence,
            );
            await page.waitForTimeout(interval);
            continue;
        }

        const queryScope =
            condition.query?.scope === 'modal'
                ? 'modal'
                : condition.query?.scope === 'page' || condition.query?.scope === 'owned-row'
                  ? 'page'
                  : 'auto';
        const snapshot = await snapshotPlaywrightPage(page, { scope: queryScope });
        if (condition.kind === 'urlContains' && snapshot.url.includes(condition.value))
            return { matched: true, elapsed_ms: Date.now() - start };
        if (condition.kind === 'textVisible') {
            if (await visibleTextCount(page, condition.value, condition.scope || 'page'))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'textAbsent') {
            if (!(await visibleTextCount(page, condition.value, condition.scope || 'page')))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlVisible') {
            const control = uniqueMatch(snapshot.controls, condition.query);
            if (control?.visible) return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlState') {
            const control = uniqueMatch(snapshot.controls, condition.query);
            const stateMatches =
                control &&
                ((condition.state === 'disabled' && control.disabled) ||
                    (condition.state === 'enabled' && !control.disabled) ||
                    (condition.state === 'expanded' && control.expanded) ||
                    (condition.state === 'collapsed' && control.expanded === false) ||
                    (condition.state === 'checked' && control.checked) ||
                    (condition.state === 'selected' && control.selected) ||
                    (condition.state === 'empty' && !control.value) ||
                    (condition.state === 'value' && control.value === condition.value));
            if (stateMatches) return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'tableHeaders') {
            const headers = [];
            for (const frame of page.frames())
                headers.push(
                    ...(await frame
                        .getByRole('columnheader')
                        .filter({ visible: true })
                        .allTextContents()
                        .catch(() => [])),
                );
            if (condition.values.every((value) => headers.some((text) => text.trim() === value)))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'rowCount') {
            const tables = page.getByRole('table').filter({ visible: true });
            if ((await tables.count().catch(() => 0)) === 1) {
                const count = await tables.locator('tbody tr').filter({ visible: true }).count();
                if (count === condition.value)
                    return { matched: true, elapsed_ms: Date.now() - start };
            }
        }
        if (condition.kind === 'formError') {
            const texts = await formErrorTexts(page);
            if (condition.labels.every((label) => texts.some((text) => text.includes(label))))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        await page.waitForTimeout(interval);
    }
    if (lastVisualFailure) throw lastVisualFailure;
    throw new BrowserContractError('wait-timeout', `Condition did not match: ${condition.kind}`);
}
