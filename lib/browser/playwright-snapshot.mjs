import { randomBytes } from 'node:crypto';
import { safeUrl } from '../diagnostics.mjs';
import { NO_ROW_INDEX, NO_TABLE_INDEX, resolveRowKey } from './identity-resolver.mjs';

const ATTR = 'data-laya-live-ref';

export async function snapshotPlaywrightPage(page, options = {}) {
    const nonce = randomBytes(5).toString('hex'),
        controls = [];
    const frames = page.frames();
    for (let fi = 0; fi < frames.length; fi++) {
        const items = await frames[fi]
            .evaluate(
                ({ nonce, fi, attr, scope, includeValues, noTableIndex, noRowIndex }) => {
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
                        'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="alert"],[tabindex],[contenteditable="true"],summary,[draggable="true"],canvas';
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
                    elements = elements.filter(
                        (e) =>
                            e.tagName.toLowerCase() !== 'canvas' ||
                            getComputedStyle(e).pointerEvents !== 'none',
                    );
                    const modalSelector =
                        'dialog[open],[role="dialog"][aria-modal="true"],[data-modal-content],.ant-modal-wrap,.el-dialog';
                    const modal = roots
                        .flatMap((root) => [...root.querySelectorAll(modalSelector)])
                        .filter(visible)
                        .at(-1);
                    const overlaySelector = [
                        '[role="menu"]',
                        '[role="listbox"]',
                        '[role="dialog"]',
                        '[role="tooltip"]',
                        '[data-menu-dropdown]',
                        '.mantine-Select-dropdown',
                        '.mantine-MultiSelect-dropdown',
                        '.mantine-DatePicker-dropdown',
                        '.mantine-Tooltip-tooltip',
                    ].join(',');
                    const overlays = roots
                        .flatMap((root) => [...root.querySelectorAll(overlaySelector)])
                        .filter(visible)
                        .filter((element) => !modal || element !== modal);
                    // Options can be portaled outside their owning dialog.
                    if (scope === 'modal' && !modal) return [];
                    if (modal && scope !== 'page' && scope !== 'owned-row')
                        elements = elements.filter(
                            (element) =>
                                modal.contains(element) ||
                                overlays.some((overlay) => overlay.contains(element)),
                        );
                    return elements
                        .slice(0, 800)
                        .map((e, i) => {
                            const tag = e.tagName.toLowerCase(),
                                type = (e.getAttribute('type') || '').toLowerCase();
                            const sensitive = Boolean(
                                type === 'password' ||
                                /password|passwd|pwd|token|api[_-]?key|secret/i.test(
                                    [
                                        type,
                                        e.id,
                                        e.getAttribute('name'),
                                        e.getAttribute('placeholder'),
                                        e.getAttribute('aria-label'),
                                        e.getAttribute('autocomplete'),
                                    ]
                                        .filter(Boolean)
                                        .join(' '),
                                ),
                            );
                            let role =
                                e.getAttribute('role') ||
                                {
                                    canvas: 'canvas',
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
                            const isCanvas = tag === 'canvas';
                            const classList =
                                e.classList && typeof e.classList[Symbol.iterator] === 'function'
                                    ? [...e.classList]
                                    : [];
                            const isMultiSelect =
                                role === 'combobox' &&
                                (classList.some((name) => name.includes('MultiSelect')) ||
                                    e.getAttribute('aria-multiselectable') === 'true');
                            const isSelect =
                                role === 'combobox' &&
                                !isMultiSelect &&
                                (e.getAttribute('aria-haspopup') === 'listbox' ||
                                    classList.some((name) => name.includes('Select')));
                            const isDate =
                                tag === 'input' &&
                                (classList.some(
                                    (name) =>
                                        name.includes('DateInput') ||
                                        name.includes('DateTimePicker'),
                                ) ||
                                    e.getAttribute('data-mantine-date') === 'true');
                            const isMantineButton =
                                tag === 'button' &&
                                role === 'button' &&
                                classList.some(
                                    (name) =>
                                        name === 'mantine-Button-root' ||
                                        name === 'mantine-ActionIcon-root' ||
                                        name === 'mantine-UnstyledButton-root',
                                );
                            const mantineComponent = isSelect
                                ? 'select'
                                : isMultiSelect
                                  ? 'multi-select'
                                  : isDate
                                    ? 'date'
                                    : role === 'option'
                                      ? 'option'
                                      : role === 'menuitem'
                                        ? 'menuitem'
                                        : isMantineButton
                                          ? 'button'
                                          : '';
                            const tablePagination = e.closest('.mantine-datatable-pagination');
                            const selectorDialog = (() => {
                                const dialog = e.closest(
                                    'dialog[open],[role="dialog"],[data-modal-content]',
                                );
                                if (!dialog) return null;
                                const table = dialog.querySelector('[role="table"],table');
                                const row = table?.querySelector('tbody tr,[role="row"]');
                                const tree = dialog.querySelector(
                                    '[role="tree"],[role="treeitem"],.mantine-Tree-root,.mantine-Tree-node',
                                );
                                const selector = row ? 'table' : tree ? 'tree' : '';
                                if (!selector) return null;
                                const confirmationNames = new Set([
                                    '确定',
                                    '确认',
                                    '提交',
                                    '保存',
                                    '选择',
                                    '完成',
                                    '应用',
                                    '是',
                                    'ok',
                                    'confirm',
                                    'submit',
                                    'save',
                                    'select',
                                    'apply',
                                    'done',
                                    'yes',
                                ]);
                                const hasConfirmation = [
                                    ...dialog.querySelectorAll(
                                        'button,[role="button"],input[type="button"],input[type="submit"]',
                                    ),
                                ].some((candidate) => {
                                    if (!visible(candidate)) return false;
                                    const markerValues = [
                                        'data-laya-confirm',
                                        'data-confirm',
                                        'aria-confirm',
                                    ]
                                        .map((name) => candidate.getAttribute(name))
                                        .filter((value) => value !== null);
                                    const explicitMarker = markerValues.some((value) => {
                                        const normalized = value.trim().toLowerCase();
                                        return !['false', '0', 'no', 'off'].includes(normalized);
                                    });
                                    if (explicitMarker) return true;
                                    const action = (candidate.getAttribute('data-action') || '')
                                        .trim()
                                        .toLowerCase();
                                    if (['confirm', 'submit', 'save', 'select'].includes(action))
                                        return true;
                                    const name = (
                                        text(candidate) ||
                                        candidate.getAttribute('aria-label') ||
                                        candidate.getAttribute('title') ||
                                        candidate.value ||
                                        ''
                                    )
                                        .replace(/\s+/g, ' ')
                                        .replace(/[。.!！:：]+$/g, '')
                                        .trim()
                                        .toLowerCase();
                                    return confirmationNames.has(name);
                                });
                                return hasConfirmation ? { selector } : null;
                            })();
                            const component = isCanvas
                                ? 'canvas'
                                : selectorDialog
                                  ? 'selector-dialog'
                                  : tablePagination
                                    ? 'table-pagination'
                                    : mantineComponent;
                            const descriptor =
                                component === 'selector-dialog' || component === 'canvas'
                                    ? { component }
                                    : component
                                      ? { adapter: 'mantine', component }
                                      : {};
                            const expandedAttr = e.getAttribute('aria-expanded');
                            const expanded = expandedAttr === null ? null : expandedAttr === 'true';
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
                            const canvasName = isCanvas
                                ? e.getAttribute('aria-label') ||
                                  e.getAttribute('data-testid') ||
                                  e.getAttribute('title') ||
                                  e.getAttribute('name') ||
                                  e.id ||
                                  ''
                                : '';
                            const domName = (
                                canvasName ||
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
                            const nameSource = domName ? 'dom' : 'synthetic';
                            const name = domName || (isCanvas ? `画布:${i + 1}` : `图标:${i + 1}`);
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
                            const table = e.closest('table,[role="table"]');
                            const allRows = table
                                ? [...table.querySelectorAll('tbody tr,[role="row"]')]
                                : [];
                            const rowIndex = row ? allRows.indexOf(row) : noRowIndex;
                            const allTables = [
                                ...document.querySelectorAll('table,[role="table"]'),
                            ];
                            const tableIndex = table ? allTables.indexOf(table) : noTableIndex;
                            const rowIdentity = {
                                dataRowKey: row?.getAttribute('data-row-key') || '',
                                testId: row?.getAttribute('data-testid') || '',
                                id: row?.id || '',
                                rowText,
                                tableIndex: tableIndex < 0 ? noTableIndex : tableIndex,
                                rowIndex: rowIndex < 0 ? noRowIndex : rowIndex,
                            };
                            const context = row
                                ? rowText.slice(0, 500)
                                : text(group?.querySelector('legend,h1,h2,h3')).slice(0, 70);
                            const describedBy = (e.getAttribute('aria-describedby') || '')
                                .split(/\s+/)
                                .map((id) => document.getElementById(id))
                                .filter(Boolean);
                            const mantineError = describedBy
                                .filter((element) =>
                                    element.classList.contains('mantine-InputWrapper-error'),
                                )
                                .map(text)
                                .join(' ');
                            const ref = nonce + '-' + fi + '-' + i;
                            e.setAttribute(attr, ref);
                            return {
                                ref,
                                frame: fi,
                                index: i,
                                tag,
                                role,
                                ...descriptor,
                                expanded,
                                testId: e.getAttribute('data-testid') || '',
                                name,
                                nameSource,
                                htmlName: e.getAttribute('name') || '',
                                id: e.id || '',
                                autocomplete: e.getAttribute('autocomplete') || '',
                                label: (labelled || labels || parentLabel || sibLabel || '').slice(
                                    0,
                                    160,
                                ),
                                tooltip,
                                rowIdentity,
                                placeholder: e.getAttribute('placeholder') || '',
                                context,
                                selector: selectorDialog?.selector || '',
                                layer: modal?.contains(e)
                                    ? 'modal'
                                    : overlays.some((overlay) => overlay.contains(e))
                                      ? 'overlay'
                                      : 'page',
                                inPanel: !!e.closest('[role="tabpanel"]'),
                                required:
                                    e.required === true ||
                                    e.getAttribute('aria-required') === 'true',
                                invalid:
                                    (typeof e.checkValidity === 'function' && !e.checkValidity()) ||
                                    !!mantineError ||
                                    !!e.closest(
                                        '.ant-form-item-has-error,.has-error,.el-form-item.is-error,.is-error',
                                    ),
                                validationMessage: mantineError || e.validationMessage || '',
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
                                href: e.getAttribute('href')
                                    ? new URL(e.getAttribute('href'), location.href).href
                                    : '',
                                sensitive,
                                value: sensitive
                                    ? '[REDACTED]'
                                    : includeValues && 'value' in e
                                      ? String(e.value).slice(0, 160)
                                      : '',
                            };
                        })
                        .filter((x) => x.name || x.role === 'password');
                },
                {
                    nonce,
                    fi,
                    attr: ATTR,
                    scope: options.scope || 'auto',
                    includeValues: options.includeValues !== false,
                    noTableIndex: NO_TABLE_INDEX,
                    noRowIndex: NO_ROW_INDEX,
                },
            )
            .catch(() => []);
        controls.push(...items);
    }
    const normalizedControls = controls.map((control) => {
        const { rowIdentity, ...rest } = control;
        return {
            ...rest,
            rowKey: resolveRowKey(rowIdentity),
            frameRef: 'f' + control.frame,
            frameIndex: control.frame,
            visible: true,
            href: control.href ? safeUrl(control.href) : '',
            snapshotNonce: nonce,
        };
    });
    const tables = [];
    let modal = null;
    for (const frame of frames) {
        const state = await frame
            .evaluate(() => {
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
                const extractText = (element) =>
                    (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
                const modalElement = [
                    ...document.querySelectorAll(
                        'dialog[open],[role="dialog"][aria-modal="true"],[data-modal-content],.ant-modal-wrap,.el-dialog',
                    ),
                ]
                    .filter(visible)
                    .at(-1);
                return {
                    tables: [...document.querySelectorAll('table,[role="table"]')]
                        .filter(visible)
                        .map((table) => ({
                            headers: [
                                ...table.querySelectorAll('thead th,[role="columnheader"]'),
                            ].map(extractText),
                            headerLayout: [
                                ...table.querySelectorAll('thead th,[role="columnheader"]'),
                            ].map((header) => ({
                                name: extractText(header),
                                position: getComputedStyle(header).position,
                                left: getComputedStyle(header).left,
                                right: getComputedStyle(header).right,
                                fixedLeft: !!header.closest('.ant-table-fixed-left'),
                                fixedRight: !!header.closest('.ant-table-fixed-right'),
                            })),
                            rows: [...table.querySelectorAll('tbody tr,[role="row"]')]
                                .filter(visible)
                                .map((row) =>
                                    [
                                        ...row.querySelectorAll(
                                            'td,[role="cell"],[role="gridcell"]',
                                        ),
                                    ].map(extractText),
                                )
                                .filter((row) => row.length > 1),
                            rowCount: [...table.querySelectorAll('tbody tr,[role="row"]')].filter(
                                visible,
                            ).length,
                        })),
                    modal: modalElement
                        ? {
                              name: (
                                  extractText(
                                      modalElement.querySelector('h1,h2,h3,[role="heading"]'),
                                  ) ||
                                  modalElement.getAttribute('aria-label') ||
                                  ''
                              ).slice(0, 160),
                              role:
                                  modalElement.getAttribute('role') ||
                                  (modalElement.tagName.toLowerCase() === 'dialog' ? 'dialog' : ''),
                              ariaModal: modalElement.getAttribute('aria-modal') === 'true',
                          }
                        : null,
                };
            })
            .catch(() => ({ tables: [], modal: null }));
        tables.push(...state.tables);
        if (state.modal) modal = state.modal;
    }
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    return {
        url: safeUrl(page.url()),
        title: String(title).slice(0, 300),
        controls: normalizedControls,
        tables,
        modal,
        observedAt: new Date().toISOString(),
        frames,
        snapshotNonce: nonce,
    };
}
