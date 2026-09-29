import { BrowserContractError } from '../contract.mjs';

const OPTION_SELECTOR = '[role="option"]:visible';
const OPTION_WAIT_TIMEOUT = 4000;

const waitForVisibleOption = async (page, value) => {
    try {
        await page
            .locator(OPTION_SELECTOR)
            .first()
            .waitFor({ state: 'visible', timeout: OPTION_WAIT_TIMEOUT });
    } catch {
        throw new BrowserContractError(
            'unsupported-capability',
            `Mantine dropdown is not open while selecting ${value}`,
        );
    }
};

const exactOptionMatches = async (page, value) => {
    const options = page.locator(OPTION_SELECTOR);
    const count = await options.count();
    const matches = [];
    for (let index = 0; index < count; index += 1) {
        const option = options.nth(index);
        if ((await option.innerText()).trim() === value) matches.push(option);
    }
    return matches;
};

const assertSingleOption = (matches, value) => {
    if (matches.length !== 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Mantine option matched ${matches.length} controls: ${value}`,
        );
};

export async function selectVisibleOption(page, value) {
    await waitForVisibleOption(page, value);
    const matches = await exactOptionMatches(page, value);
    assertSingleOption(matches, value);
    await matches[0].click({ timeout: OPTION_WAIT_TIMEOUT });
}

export async function selectVisibleOptions(page, values) {
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        await waitForVisibleOption(page, value);
        const matches = await exactOptionMatches(page, value);
        assertSingleOption(matches, value);
        await matches[0].click({ timeout: OPTION_WAIT_TIMEOUT });
        if (index < values.length - 1) await waitForVisibleOption(page, value);
    }
}

const isValidDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
};

const waitForSettledInput = async (locator) => {
    const deadline = Date.now() + OPTION_WAIT_TIMEOUT;
    let current = await locator.inputValue().catch(() => '');
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const next = await locator.inputValue().catch(() => '');
        if (next === current) return next;
        current = next;
    }
    return current;
};

export async function fillMantineDate(locator, value) {
    await locator.click({ timeout: OPTION_WAIT_TIMEOUT });
    await locator.fill(value, { timeout: OPTION_WAIT_TIMEOUT });
    await locator.press('Enter').catch(() => {});
    const actual = await waitForSettledInput(locator);
    if (actual !== value || !isValidDate(actual))
        throw new BrowserContractError(
            'unsupported-capability',
            `Mantine date value was not accepted: expected ${value}, got ${actual || '<empty>'}`,
        );
}
