import { BrowserContractError, validateCommand } from './contract.mjs';

const locatorFor = (page, control) => {
    const frame = page.frames()[control.frameIndex];
    if (!frame) throw new BrowserContractError('stale-ref', 'Frame is no longer available');
    return frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
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

    if (command.kind === 'click') await locator.click({ timeout: 4000 });
    else if (command.kind === 'fill') {
        const value =
            command.clear === false
                ? String(await locator.inputValue()) + command.value
                : command.value;
        await locator.fill(value, { timeout: 4000 });
    } else if (command.kind === 'clear') await locator.fill('', { timeout: 4000 });
    else if (command.kind === 'select') await locator.selectOption(command.values);
    else if (command.kind === 'check') await locator.check();
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
