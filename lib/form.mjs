import { controlHandle } from './dom.mjs';

const legacy = () => import('./browser/playwright-form-legacy.mjs');

export async function inspectForm(source) {
    if (source?.snapshot) return snapshotInspectForm(await source.snapshot());
    return (await legacy()).inspectForm(source);
}

export async function findFormItem(source, label) {
    if (!source?.snapshot) return (await legacy()).findFormItem(source, label);
    const matches = snapshotInspectForm(await source.snapshot()).filter(
        (item) => item.label === label,
    );
    if (matches.length !== 1)
        throw Error(`表单字段「${label}」数量为${matches.length}，无法安全定位`);
    const control = matches[0].inputs[0]?.control;
    return { info: matches[0], item: control ? controlHandle(source, control) : null };
}

export async function inspectLooseRequired(source) {
    if (source?.snapshot) return snapshotInspectLooseRequired(await source.snapshot());
    return (await legacy()).inspectLooseRequired(source);
}

export async function looseInputRef(source, target) {
    if (source?.snapshot)
        return snapshotFindLooseInput(await source.snapshot(), target)?.ref || null;
    return (await legacy()).looseInputRef(source, target);
}

export async function formErrors(source) {
    if (source?.snapshot) return snapshotFormErrors(await source.snapshot());
    return (await legacy()).formErrors(source);
}

export async function visibleOptions(source) {
    if (source?.snapshot) return snapshotVisibleOptions(await source.snapshot());
    return (await legacy()).visibleOptions(source);
}

export function snapshotInspectForm(snapshot) {
    const groups = new Map();
    for (const control of snapshot.controls || []) {
        if (!control.label || control.role === 'password') continue;
        const key = control.label + '\n' + (control.context || '');
        if (!groups.has(key))
            groups.set(key, {
                ref: control.ref,
                label: control.label,
                required: false,
                combo: false,
                chosen: '',
                inputs: [],
                sectionText: control.context || control.label,
            });
        const item = groups.get(key);
        item.required ||= Boolean(control.required);
        item.combo ||= control.role === 'combobox' || control.tag === 'select';
        if (item.combo) item.chosen = control.value || control.name;
        item.inputs.push({
            ref: control.ref,
            type: control.tag,
            role: control.role,
            placeholder: control.placeholder,
            value: control.value,
            readonly: control.readonly || control.disabled,
            required: Boolean(control.required),
            invalid: Boolean(control.invalid),
            validationMessage: control.validationMessage || '',
            control,
        });
    }
    return [...groups.values()];
}

export function snapshotInspectLooseRequired(snapshot) {
    const counts = new Map();
    return (snapshot.controls || [])
        .filter(
            (control) =>
                control.required &&
                !control.disabled &&
                !control.readonly &&
                control.role !== 'combobox' &&
                !control.label,
        )
        .map((control) => {
            const placeholder = control.placeholder || '';
            const index = counts.get(placeholder) || 0;
            counts.set(placeholder, index + 1);
            return {
                ref: control.ref,
                label: control.label || '',
                placeholder,
                index,
                role: control.role,
                type: control.tag,
                value: control.value || '',
            };
        });
}

export function snapshotFindLooseInput(snapshot, { label, placeholder, index }) {
    const controls = snapshot.controls || [];
    if (label) {
        const matches = controls.filter((control) => control.label === label);
        return matches.length === 1 ? matches[0] : null;
    }
    const matches = controls.filter(
        (control) => control.placeholder === placeholder && control.required,
    );
    return matches[index || 0] || null;
}

export function snapshotFormErrors(snapshot) {
    const controls = snapshot.controls || [];
    const invalid = controls.filter((control) => control.invalid);
    const alerts = controls.filter((control) => control.role === 'alert' && control.name);
    const labels = [
        ...new Set(
            invalid
                .map(
                    (control) =>
                        control.label || control.name || control.placeholder || control.htmlName,
                )
                .filter(Boolean),
        ),
    ];
    const messages = [
        ...new Set([
            ...invalid.map((control) => control.validationMessage).filter(Boolean),
            ...alerts.map((control) => control.name),
        ]),
    ];
    return { open: true, labels, messages };
}

export function snapshotVisibleOptions(snapshot) {
    return (snapshot.controls || [])
        .filter(
            (control) =>
                control.visible &&
                !control.disabled &&
                ['option', 'treeitem', 'menuitem', 'menuitemcheckbox'].includes(control.role),
        )
        .slice(0, 100)
        .map((control) => ({
            ref: control.ref,
            name: control.name,
            role: control.role,
            treeItem: control.role === 'treeitem',
            expandable: false,
            numeric: false,
        }));
}

export function generatedInputValue(label, placeholder, role, token, index = 0) {
    const hint = label + ' ' + placeholder;
    const interval = hint.match(/[[(]\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*[)\]]/);
    if (interval) return interval[0];
    if (role === 'spinbutton' || /数字|数量|金额|年龄|数值|number|amount|count/i.test(hint))
        return '1';
    if (/邮箱|email/i.test(hint)) return `laya_${token}@example.com`;
    if (/网址|URL/i.test(hint)) return 'https://example.com';
    if (/默认|default/i.test(hint)) return '默认_' + token;
    if (/返回|结果|return|result/i.test(hint)) return '结果_' + token;
    return '测试_' + token + (index ? '_' + index : '');
}

export function invalidExampleValue(placeholder) {
    const interval = placeholder.match(/[[(]\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*[)\]]/);
    return interval ? '【' + interval[0].slice(1) : null;
}
