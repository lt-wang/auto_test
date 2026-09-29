import { BrowserContractError, validateCommand } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import { fillMantineDate, selectVisibleOption } from './adapters/mantine-actions.mjs';

const locatorFor = (page, control) => {
    const frame = page.frames()[control.frameIndex];
    if (!frame) throw new BrowserContractError('stale-ref', 'Frame is no longer available');
    return frame.locator(`[data-laya-live-ref="${control.ref}"]`).first();
};

const resolveUniqueFileInput = async (candidates) => {
    const count = await candidates.count();
    if (count > 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Upload target matched ${count} file inputs`,
        );
    return count === 1 ? candidates.first() : null;
};

const resolveFileInput = async (control, locator) => {
    if (control.tag === 'input') {
        const type = await locator.getAttribute('type').catch(() => '');
        if (type === 'file') return locator;
    }
    const nested = await resolveUniqueFileInput(locator.locator('input[type="file"]'));
    if (nested) return nested;
    const owner = locator.locator('xpath=ancestor::*[.//input[@type="file"]][1]');
    if (!(await owner.count())) return null;
    return resolveUniqueFileInput(owner.locator('input[type="file"]'));
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
        if (control.component === 'date') await fillMantineDate(locator, value);
        else await locator.fill(value, { timeout: 4000 });
    } else if (command.kind === 'clear') await locator.fill('', { timeout: 4000 });
    else if (command.kind === 'select') {
        if (control.tag === 'select') await locator.selectOption(command.values);
        else if (control.component === 'select' || control.component === 'multi-select') {
            for (const value of command.values) {
                await locator.click({ timeout: 4000 });
                await selectVisibleOption(page, value);
            }
        } else await selectCustomControl(page, locator, command.values);
    } else if (command.kind === 'upload') {
        const fileInput = await resolveFileInput(control, locator);
        if (fileInput) {
            await fileInput.setInputFiles(command.files, { timeout: 4000 });
        } else {
            const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
            try {
                await locator.click({ timeout: 4000 });
                const chooser = await chooserPromise;
                await chooser.setFiles(command.files);
            } catch (error) {
                await chooserPromise.catch(() => {});
                throw error;
            }
        }
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
