import { randomBytes } from 'node:crypto';
import { validateSnapshot } from './contract.mjs';

const ATTR = 'data-laya-live-ref';

export async function snapshotPlaywrightPage(page, options = {}) {
    const nonce = randomBytes(5).toString('hex'),
        controls = [];
    const frames = page.frames();
    for (let fi = 0; fi < frames.length; fi++) {
        const items = await frames[fi]
            .evaluate(
                ({ nonce, fi, attr, scope }) => {
                    const visible = (e) => {
                        const s = getComputedStyle(e),
                            r = e.getBoundingClientRect();
                        return (
                            s.display !== 'none' &&
                            s.visibility !== 'hidden' &&
                            r.width > 0 &&
                            r.height > 0 &&
                            !e.closest('[inert],[aria-hidden="true"]')
                        );
                    };
                    const text = (e) =>
                        (e?.innerText || e?.textContent || '').replace(/\s+/g, ' ').trim();
                    const roots = [document];
                    for (let i = 0; i < roots.length; i++)
                        for (const e of roots[i].querySelectorAll('*'))
                            if (e.shadowRoot) roots.push(e.shadowRoot);
                    const selector =
                        'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[tabindex],[contenteditable="true"],summary';
                    let elements = roots
                        .flatMap((root) => [...root.querySelectorAll(selector)])
                        .filter(visible);
                    // Some enterprise navigation bars have clickable divs with no ARIA roles.
                    const pointer = roots
                        .flatMap((root) => [...root.querySelectorAll('div,span,li')])
                        .filter(
                            (e) =>
                                visible(e) &&
                                getComputedStyle(e).cursor === 'pointer' &&
                                text(e).length > 0 &&
                                text(e).length < 45 &&
                                !e.closest(selector) &&
                                !e.querySelector(selector) &&
                                ![...e.children].some(
                                    (c) => getComputedStyle(c).cursor === 'pointer',
                                ),
                        );
                    elements = [...new Set([...elements, ...pointer])];
                    // A menuitem wrapping its same-named link is one action, not two Laya
                    // candidates. Keep the inner native control and retain distinct siblings.
                    elements = elements.filter(
                        (e) =>
                            !(
                                e.getAttribute('role') === 'menuitem' &&
                                [...e.querySelectorAll('a[href],button')].some(
                                    (child) => visible(child) && text(child) === text(e),
                                )
                            ),
                    );
                    const modals = roots
                        .flatMap((root) => [
                            ...root.querySelectorAll(
                                'dialog[open],[role="dialog"],[role="alertdialog"],[data-slot="dialog-content"],[data-slot="alert-dialog-content"],.ant-drawer-open .ant-drawer-content,.el-dialog',
                            ),
                        ])
                        .filter(visible);
                    const modal = modals.at(-1);
                    // Options can be portaled outside their owning dialog.
                    if (modal && scope !== 'page')
                        elements = elements.filter(
                            (e) =>
                                modal.contains(e) ||
                                e.closest(
                                    '[role="listbox"],.ant-select-dropdown,.el-select-dropdown',
                                ),
                        );
                    return elements
                        .slice(0, 800)
                        .map((e, i) => {
                            const tag = e.tagName.toLowerCase(),
                                type = e.getAttribute('type') || '';
                            let role =
                                e.getAttribute('role') ||
                                {
                                    button: 'button',
                                    a: 'link',
                                    textarea: 'textbox',
                                    select: 'combobox',
                                    summary: 'button',
                                }[tag] ||
                                (tag === 'input'
                                    ? {
                                          checkbox: 'checkbox',
                                          radio: 'radio',
                                          number: 'spinbutton',
                                          password: 'password',
                                      }[type] || 'textbox'
                                    : 'button');
                            const labelled = (e.getAttribute('aria-labelledby') || '')
                                .split(/\s+/)
                                .map((id) => text(document.getElementById(id)))
                                .join(' ')
                                .trim();
                            const labels = e.labels ? [...e.labels].map(text).join(' ') : '';
                            const parentLabel = text(
                                e.closest('.ant-form-item,.el-form-item')?.querySelector('label'),
                            );
                            let sibLabel = '';
                            if (['input', 'textarea', 'select'].includes(tag)) {
                                let n = e.previousElementSibling;
                                while (n) {
                                    if (/^label$/i.test(n.tagName)) {
                                        sibLabel = text(n);
                                        break;
                                    }
                                    n = n.previousElementSibling;
                                }
                                if (!sibLabel) {
                                    n = e.parentElement?.previousElementSibling || null;
                                    while (n) {
                                        if (/^label$/i.test(n.tagName)) {
                                            sibLabel = text(n);
                                            break;
                                        }
                                        n = n.previousElementSibling;
                                    }
                                }
                            }
                            const selectBox = e.closest(
                                '.ant-select,.tntd-rc-select,.el-select,[role="combobox"]',
                            );
                            const selectHint =
                                text(
                                    selectBox?.querySelector(
                                        '.ant-select-selection__placeholder,.ant-select-selection-placeholder,.tntd-rc-select-selection-placeholder,.el-input__inner',
                                    ),
                                ) || text(selectBox);
                            const ownText = ['input', 'textarea'].includes(tag) ? '' : text(e);
                            const tooltip = e.getAttribute('data-laya-tooltip-label') || '';
                            const tooltipAction = tooltip.match(/不支持(.+?)(?:操作)?$/)?.[1];
                            const name = (
                                tooltipAction ||
                                tooltip ||
                                e.getAttribute('aria-label') ||
                                labelled ||
                                labels ||
                                parentLabel ||
                                sibLabel ||
                                e.getAttribute('placeholder') ||
                                e.getAttribute('title') ||
                                ownText ||
                                selectHint ||
                                e.getAttribute('name') ||
                                ''
                            )
                                .replace(/^\*\s*/, '')
                                .slice(0, 130);
                            const row = e.closest('tr,[role="row"]'),
                                group = e.closest('fieldset,[role="group"],form');
                            const rowKey = row?.getAttribute('data-row-key') || '';
                            // Fixed operation columns have rows containing only icons. Join their live
                            // data-row-key to the main table, rather than mistaking all icons for one row.
                            const peers = rowKey
                                ? [...document.querySelectorAll('tr[data-row-key]')].filter(
                                      (r) => r.getAttribute('data-row-key') === rowKey,
                                  )
                                : [];
                            const rowText = [
                                ...new Set([text(row), ...peers.map(text)].filter(Boolean)),
                            ]
                                .sort((a, b) => b.length - a.length)
                                .join(' | ');
                            const context = row
                                ? rowText.slice(0, 500)
                                : text(group?.querySelector('legend,h1,h2,h3')).slice(0, 70);
                            const ref = nonce + '-' + fi + '-' + i;
                            e.setAttribute(attr, ref);
                            return {
                                ref,
                                frame: fi,
                                tag,
                                role,
                                name,
                                tooltip,
                                rowKey,
                                placeholder: e.getAttribute('placeholder') || '',
                                context,
                                inPanel: !!e.closest('[role="tabpanel"]'),
                                disabled:
                                    e.matches(':disabled') ||
                                    e.hasAttribute('disabled') ||
                                    e.getAttribute('aria-disabled') === 'true' ||
                                    !!e.closest(
                                        '.ant-select-disabled,[aria-disabled="true"],.disabled,.is-disabled',
                                    ) ||
                                    (role === 'menuitem' &&
                                        !!e.querySelector(
                                            'a[disabled],button[disabled],a.disabled,button.disabled',
                                        )),
                                readonly: e.readOnly === true,
                                selected:
                                    e.getAttribute('aria-selected') === 'true' ||
                                    e.classList.contains('ant-menu-item-selected') ||
                                    !!e.closest('.ant-menu-item-selected'),
                                checked:
                                    e.checked === true || e.getAttribute('aria-checked') === 'true',
                                href: e.getAttribute('href') || '',
                                value:
                                    type === 'password'
                                        ? '[REDACTED]'
                                        : ('value' in e ? String(e.value) : '').slice(0, 160),
                            };
                        })
                        .filter((x) => x.name || x.role === 'password');
                },
                { nonce, fi, attr: ATTR, scope: options.scope || 'auto' },
            )
            .catch(() => []);
        controls.push(...items);
    }
    const normalizedControls = controls.map((control) => ({
        ...control,
        frameRef: 'f' + control.frame,
        frameIndex: control.frame,
        visible: true,
    }));
    return validateSnapshot({ url: page.url(), controls: normalizedControls, frames });
}
