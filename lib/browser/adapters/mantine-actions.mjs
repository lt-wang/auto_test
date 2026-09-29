import { BrowserContractError } from '../contract.mjs';

export async function selectVisibleOption(page, value) {
    const options = page.locator('[role="option"]:visible');
    const count = await options.count();
    const matches = [];
    for (let index = 0; index < count; index += 1) {
        const option = options.nth(index);
        if ((await option.innerText()).trim() === value) matches.push(option);
    }
    if (matches.length !== 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Mantine option matched ${matches.length} controls: ${value}`,
        );
    await matches[0].click({ timeout: 4000 });
}

export async function fillMantineDate(locator, value) {
    await locator.click({ timeout: 4000 });
    await locator.fill(value, { timeout: 4000 });
    await locator.press('Enter').catch(() => {});
    const actual = await locator.inputValue().catch(() => '');
    if (actual !== value)
        throw new BrowserContractError(
            'unsupported-capability',
            `Mantine date value was not accepted: expected ${value}, got ${actual || '<empty>'}`,
        );
}
