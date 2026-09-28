import { BrowserContractError, validateCommand } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';

const locatorFor = (page, control) => {
    const frame = page.frames()[control.frameIndex];
    if (!frame) throw new BrowserContractError('stale-ref', 'Frame is no longer available');
    return frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
};

const selectCustomControl = async (page, locator, values) => {
    for (const value of values) {
        await locator.click({ timeout: 4000 });
        await page.waitForTimeout(80);
        const snapshot = await snapshotPlaywrightPage(page);
        const matches = snapshot.controls.filter(
            (control) =>
                control.name === value && ['option', 'menuitem', 'radio'].includes(control.role),
        );
        if (matches.length !== 1)
            throw new BrowserContractError(
                'ambiguous-query',
                `Select option matched ${matches.length} controls: ${value}`,
            );
        await locatorFor(page, matches[0]).click({ timeout: 4000 });
        await page.waitForTimeout(80);
    }
};

export async function executePlaywrightCommand(page, refs, rawCommand) {
    const command = validateCommand(rawCommand);
    if (command.kind === 'press' && !command.ref) {
        await page.keyboard.press(command.key);
        return { ok: true, ref: null };
    }

    const control = refs.get(command.ref);
    if (!control) throw new BrowserContractError('missing-ref', command.ref);
    if (control.disabled) throw new BrowserContractError('disabled-ref', command.ref);
    const locator = locatorFor(page, control);
    if (!(await locator.count()))
        throw new BrowserContractError('stale-ref', `Control ${command.ref} is no longer present`);

    if (command.kind === 'click') {
        await locator.click({
            timeout: 4000,
            ...(command.button ? { button: command.button } : {}),
            ...(command.modifiers ? { modifiers: command.modifiers } : {}),
        });
    } else if (command.kind === 'fill') {
        const value =
            command.clear === false
                ? String(await locator.inputValue()) + command.value
                : command.value;
        await locator.fill(value, { timeout: 4000 });
    } else if (command.kind === 'clear') await locator.fill('', { timeout: 4000 });
    else if (command.kind === 'select') {
        if (control.tag === 'select') await locator.selectOption(command.values);
        else await selectCustomControl(page, locator, command.values);
    } else if (command.kind === 'check') await locator.check();
    else if (command.kind === 'uncheck') await locator.uncheck();
    else if (command.kind === 'hover') await locator.hover();
    else if (command.kind === 'press') await locator.press(command.key);
    else if (command.kind === 'scroll') {
        const amount = command.amount ?? 300;
        await locator.evaluate(
            (element, { direction, amount }) =>
                element.scrollBy(0, direction === 'down' ? amount : -amount),
            { direction: command.direction, amount },
        );
    }
    return { ok: true, ref: command.ref };
}
