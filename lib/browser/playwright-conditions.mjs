import { BrowserContractError, validateCondition } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';

const matchesQuery = (control, query) =>
    control.name === query.name &&
    (!query.role || control.role === query.role) &&
    (!query.rowKey || control.rowKey === query.rowKey) &&
    (query.index === undefined || control.index === query.index);

const visibleTextCount = async (page, value) => {
    let count = 0;
    for (const frame of page.frames())
        count += await frame
            .getByText(value, { exact: false })
            .filter({ visible: true })
            .count()
            .catch(() => 0);
    return count;
};

const formErrorTexts = async (page) => {
    const texts = [];
    for (const frame of page.frames()) {
        const locator = frame.locator(
            '[role="alert"]:visible,.ant-form-item-explain-error:visible,.el-form-item__error:visible',
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
    while (Date.now() - start <= timeout) {
        const queryScope = condition.query?.scope === 'page' ? 'page' : 'modal';
        const snapshot = await snapshotPlaywrightPage(page, { scope: queryScope });
        if (condition.kind === 'urlContains' && snapshot.url.includes(condition.value))
            return { matched: true, elapsed_ms: Date.now() - start };
        if (condition.kind === 'textVisible') {
            if (await visibleTextCount(page, condition.value))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'textAbsent') {
            if (!(await visibleTextCount(page, condition.value)))
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlVisible') {
            if (
                snapshot.controls.some(
                    (control) => control.visible && matchesQuery(control, condition.query),
                )
            )
                return { matched: true, elapsed_ms: Date.now() - start };
        }
        if (condition.kind === 'controlState') {
            const control = snapshot.controls.find((item) => matchesQuery(item, condition.query));
            const stateMatches =
                control &&
                ((condition.state === 'disabled' && control.disabled) ||
                    (condition.state === 'enabled' && !control.disabled) ||
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
    throw new BrowserContractError('wait-timeout', `Condition did not match: ${condition.kind}`);
}
