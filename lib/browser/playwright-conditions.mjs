import { BrowserContractError, validateCondition } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';

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
    while (Date.now() - start <= timeout) {
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
