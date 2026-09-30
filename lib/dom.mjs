import { Halt, norm } from './language.mjs';
import { controlHandle as legacyControlHandle } from './browser/playwright-dom-legacy.mjs';

const isSession = (source) => Boolean(source && typeof source.snapshot === 'function');
const legacy = () => import('./browser/playwright-dom-legacy.mjs');

export async function observe(source) {
    if (isSession(source)) return source.snapshot();
    return (await legacy()).observe(source);
}

export function controlHandle(source, control) {
    if (!isSession(source)) return null;
    return {
        control,
        async click(options = {}) {
            if (options.trial) return { ok: true, trial: true };
            return source.act({
                kind: 'click',
                ref: control.ref,
                ...(options.button ? { button: options.button } : {}),
                ...(options.modifiers ? { modifiers: options.modifiers } : {}),
            });
        },
        async fill(value) {
            return source.act({ kind: 'fill', ref: control.ref, value });
        },
        async hover() {
            return source.act({ kind: 'hover', ref: control.ref });
        },
        async check() {
            return source.act({ kind: 'check', ref: control.ref });
        },
        async uncheck() {
            return source.act({ kind: 'uncheck', ref: control.ref });
        },
        async selectOption(values) {
            return source.act({
                kind: 'select',
                ref: control.ref,
                values: Array.isArray(values) ? values : [values],
            });
        },
        async count() {
            return 1;
        },
        async isVisible() {
            return control.visible !== false;
        },
        async inputValue() {
            const snapshot = await source.snapshot();
            let matches = snapshot.controls.filter(
                (candidate) => candidate.role === control.role && candidate.name === control.name,
            );
            if (control.rowKey)
                matches = matches.filter((candidate) => candidate.rowKey === control.rowKey);
            if (control.frameRef)
                matches = matches.filter((candidate) => candidate.frameRef === control.frameRef);
            if (control.context)
                matches = matches.filter((candidate) => candidate.context === control.context);
            const item = matches[0];
            return item?.value ?? '';
        },
    };
}

export function score(target, control) {
    const t = norm(target),
        n = norm(control.name),
        p = norm(control.placeholder),
        context = norm(control.context);
    if (!t) return 0;
    let result = n === t ? 120 : n.includes(t) ? 85 : t.includes(n) && n.length > 1 ? 65 : 0;
    if (p && p.includes(t)) result = Math.max(result, 75);
    if (context.includes(t)) result += 30;
    const chars = new Set([...t]);
    result +=
        ([...new Set([...n])].filter((char) => chars.has(char)).length / Math.max(1, chars.size)) *
        12;
    return result;
}

export async function discoverLabels(source, options = {}) {
    if (source?.discoverLabels) return source.discoverLabels(options);
    return (await legacy()).discoverRowLabels(source, options.rowKey || '');
}

export async function discoverRowLabels(source, rowKey) {
    if (source?.discoverLabels) return source.discoverLabels({ rowKey });
    return (await legacy()).discoverRowLabels(source, rowKey);
}

export async function target(source, laya, intent, options = {}) {
    if (!isSession(source)) return (await legacy()).target(source, laya, intent, options);
    const {
        kind = 'click',
        value,
        meta = {},
        rowKey,
        allowDisabled = false,
        minProbability = 0.68,
        minMargin = 0.18,
    } = options;
    let snapshot = await source.snapshot();
    for (
        let i = 0;
        i < 8 && !snapshot.controls.some((control) => score(intent, control) >= 65);
        i++
    ) {
        await source.settle(250);
        snapshot = await source.snapshot();
    }
    let candidates = snapshot.controls.filter(
        (control) => control.role !== 'password' && (allowDisabled || !control.disabled),
    );
    if (rowKey) candidates = candidates.filter((control) => control.rowKey === rowKey);
    if (['fill', 'clear', 'value', 'empty'].includes(kind))
        candidates = candidates.filter(
            (control) => ['textbox', 'spinbutton'].includes(control.role) && !control.readonly,
        );
    if (kind === 'select')
        candidates = candidates.filter(
            (control) => control.role === 'combobox' || control.tag === 'select',
        );
    if (['check', 'uncheck', 'checked'].includes(kind))
        candidates = candidates.filter((control) =>
            ['checkbox', 'radio', 'switch'].includes(control.role),
        );
    if (kind === 'option')
        candidates = candidates.filter((control) =>
            ['option', 'menuitem', 'button'].includes(control.role),
        );
    const ranked = candidates
        .map((control) => ({ ...control, rank: score(intent, control) }))
        .sort((a, b) => b.rank - a.rank);
    const unique = [];
    for (const control of ranked)
        if (
            !unique.some(
                (item) =>
                    item.name === control.name &&
                    item.context === control.context &&
                    item.role === control.role &&
                    item.frameRef === control.frameRef &&
                    item.href === control.href,
            )
        )
            unique.push(control);
    if (!unique.length)
        throw new Halt('页面控件不足', `当前页面没有可用于${kind}的控件：${intent}`);
    const shortlist = unique.slice(0, 5);
    const prefix = /[a-z]/i.test(intent) && !/[\u4e00-\u9fff]/.test(intent) ? 'Choose ' : '选择';
    const keyed = shortlist.map((control, i) => ({
        key:
            control.name.slice(0, 36) +
            (shortlist.filter((item) => item.name === control.name).length > 1 ? ' #' + i : ''),
        control,
    }));
    const criteria = Object.fromEntries(
        keyed.map(({ key, control }) => [key, prefix + control.name.slice(0, 38)]),
    );
    criteria['停止'] = '不执行';
    const decision = await laya.choose(prefix + intent, criteria, {
        ...meta,
        phase: 'target',
        url: snapshot.url,
    });
    if (decision.choice === '停止') throw new Halt('Laya无法判断', `Laya未找到匹配控件：${intent}`);
    const control = keyed.find((item) => item.key === decision.choice)?.control;
    if (!control) throw new Halt('模型结果无效', '模型返回无法映射到当前DOM的目标');
    if (
        (decision.probabilities?.[decision.choice] || 0) < minProbability ||
        decision.margin < minMargin
    )
        throw new Halt('Laya选择不确定', `目标“${intent}”的候选评分或差距不足，停止本步。`);
    return { locator: controlHandle(source, control), control, decision };
}

export async function settle(source, ms = 250) {
    if (isSession(source)) return source.settle(ms);
    return (await legacy()).settle(source, ms);
}

export async function assertionTarget(source, name, kind, { rowKey } = {}) {
    if (!isSession(source)) return (await legacy()).assertionTarget(source, name, kind, { rowKey });
    const snapshot = await source.snapshot();
    let items = snapshot.controls.filter((control) => control.role !== 'password');
    if (rowKey) items = items.filter((control) => control.rowKey === rowKey);
    if (['empty', 'value'].includes(kind))
        items = items.filter((control) =>
            ['textbox', 'spinbutton', 'combobox'].includes(control.role),
        );
    if (kind === 'checked')
        items = items.filter((control) => ['checkbox', 'radio', 'switch'].includes(control.role));
    if (kind === 'selected') items = items.filter((control) => control.role === 'tab');
    const exact = items.filter((control) => norm(control.name) === norm(name));
    const matches = exact.length
        ? exact
        : items.filter((control) => norm(control.placeholder) === norm(name));
    if (matches.length !== 1)
        throw new Halt(
            '断言目标不唯一',
            `预期中的“${name}”对应${matches.length}个明确控件，无法证明断言`,
        );
    return { control: matches[0], locator: controlHandle(source, matches[0]) };
}
