import { BrowserContractError, validateCommand } from './contract.mjs';
import { snapshotPlaywrightPage } from './playwright-snapshot.mjs';
import {
    fillMantineDate,
    selectVisibleOption,
    selectVisibleOptions,
} from './adapters/mantine-actions.mjs';

const rawLocatorFor = (page, control) => {
    const frame = page.frames()[control.frameIndex];
    if (!frame) throw new BrowserContractError('stale-ref', 'Frame is no longer available');
    return frame.locator(`[data-laya-live-ref="${control.ref}"]`);
};

const locatorFor = async (page, control) => {
    const locator = rawLocatorFor(page, control);
    const count = await locator.count();
    if (count === 0)
        throw new BrowserContractError('stale-ref', `Control ${control.ref} is no longer present`);
    if (count !== 1)
        throw new BrowserContractError(
            'ambiguous-query',
            `Control ref matched ${count} elements: ${control.ref}`,
        );
    return locator.first();
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
        const optionLocator = await locatorFor(page, matches[0]);
        await optionLocator.click({ timeout: 4000 });
        await page.waitForTimeout(80);
    }
};

const dragBetween = async (page, from, to, steps = 12, delay = 20) => {
    const sourceBox = await from.boundingBox();
    const targetBox = await to.boundingBox();
    if (!sourceBox || !targetBox)
        throw new BrowserContractError('stale-ref', 'Drag source or target is not visible');
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= steps; index += 1) {
        await page.mouse.move(
            start.x + ((end.x - start.x) * index) / steps,
            start.y + ((end.y - start.y) * index) / steps,
        );
        if (delay) await page.waitForTimeout(delay);
    }
    await page.mouse.up();
};

export async function executePlaywrightCommand(page, refs, rawCommand) {
    const command = validateCommand(rawCommand);
    if (command.kind === 'press' && !command.ref) {
        await page.keyboard.press(command.key);
        return { ok: true, ref: null };
    }

    if (command.kind === 'runtime') {
        if (
            command.ref &&
            (command.action === 'canvas.click' || command.action === 'canvas.hover')
        ) {
            const control = refs.get(command.ref);
            if (!control) throw new BrowserContractError('missing-ref', command.ref);
            if (control.disabled) throw new BrowserContractError('disabled-ref', command.ref);
            const locator = await locatorFor(page, control);
            const box = await locator.boundingBox();
            if (!box) throw new BrowserContractError('stale-ref', command.ref);
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            if (command.action === 'canvas.click') await page.mouse.click(x, y);
            else await page.mouse.move(x, y);
            return { ok: true, ref: command.ref };
        }

        const value = await page.evaluate(
            ({ action, args }) => globalThis.__layaRuntime?.invoke?.(action, args ?? {}),
            { action: command.action, args: command.args ?? {} },
        );
        if (value?.__layaRuntimeError)
            throw new BrowserContractError(
                value.__layaRuntimeError.code,
                value.__layaRuntimeError.message,
            );
        if (value === undefined)
            throw new BrowserContractError(
                'unsupported-capability',
                `Runtime action is not supported: ${command.action}`,
            );
        return { ok: true, ref: command.ref || null, value };
    }

    const control = refs.get(command.ref);
    if (!control) throw new BrowserContractError('missing-ref', command.ref);
    if (control.disabled) throw new BrowserContractError('disabled-ref', command.ref);
    const locator = await locatorFor(page, control);

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
        else if (control.component === 'select') {
            for (const value of command.values) {
                await locator.click({ timeout: 4000 });
                await selectVisibleOption(page, value);
            }
        } else if (control.component === 'multi-select') {
            if (!control.expanded) await locator.click({ timeout: 4000 });
            await selectVisibleOptions(page, command.values);
        } else await selectCustomControl(page, locator, command.values);
    } else if (command.kind === 'drag') {
        const targetControl = refs.get(command.toRef);
        if (!targetControl) throw new BrowserContractError('missing-ref', command.toRef);
        await dragBetween(
            page,
            locator,
            await locatorFor(page, targetControl),
            command.steps || 12,
            command.delay ?? 20,
        );
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
