import { snapshotPlaywrightPage } from './browser/playwright-snapshot.mjs';
import { Halt, norm } from './language.mjs';
const ATTR = 'data-laya-live-ref';
export async function observe(page) {
    return snapshotPlaywrightPage(page);
}
export function score(target, c) {
    const t = norm(target),
        n = norm(c.name),
        p = norm(c.placeholder),
        context = norm(c.context);
    if (!t) return 0;
    let s = n === t ? 120 : n.includes(t) ? 85 : t.includes(n) && n.length > 1 ? 65 : 0;
    if (p && p.includes(t)) s = Math.max(s, 75);
    if (context.includes(t)) s += 30;
    const a = new Set([...t]);
    s += ([...new Set([...n])].filter((x) => a.has(x)).length / Math.max(1, a.size)) * 12;
    return s;
}
export async function discoverRowLabels(page, rowKey) {
    let snap = await observe(page);
    const icons = snap.controls.filter((c) => c.rowKey === rowKey && /^图标[:：]/.test(c.name));
    // Only hover real DOM controls, never click an unknown icon to discover it.
    for (const icon of icons.slice(0, 12)) {
        const loc = snap.frames[icon.frame].locator(`[${ATTR}="${icon.ref}"]`);
        try {
            await page.mouse.move(0, 0);
            const tips = snap.frames[icon.frame].locator(
                '[role="tooltip"]:visible,.ant-tooltip:visible,.el-tooltip__popper:visible',
            );
            await tips
                .first()
                .waitFor({ state: 'hidden', timeout: 900 })
                .catch(() => {});
            await loc.hover({ timeout: 1500 });
            await tips
                .first()
                .waitFor({ state: 'visible', timeout: 650 })
                .catch(() => {});
            await page.waitForTimeout(350);
            const labels = [
                ...new Set((await tips.allTextContents()).map((s) => s.trim()).filter(Boolean)),
            ];
            if (labels.length === 1 && labels[0].length < 100)
                await loc.evaluate(
                    (e, label) => e.setAttribute('data-laya-tooltip-label', label),
                    labels[0],
                );
        } catch {}
    }
    await page.mouse.move(0, 0);
    return observe(page);
}
export async function target(
    page,
    laya,
    intent,
    {
        kind = 'click',
        value,
        meta = {},
        rowKey,
        allowDisabled = false,
        minProbability = 0.68,
        minMargin = 0.18,
    } = {},
) {
    let snap = await observe(page);
    // Bounded observation retries accommodate late asynchronous rendering; no action is retried.
    for (let i = 0; i < 8 && !snap.controls.some((c) => score(intent, c) >= 65); i++) {
        await page.waitForTimeout(250);
        snap = await observe(page);
    }
    let candidates = snap.controls.filter(
        (c) => c.role !== 'password' && (allowDisabled || !c.disabled),
    );
    if (rowKey) candidates = candidates.filter((c) => c.rowKey === rowKey);
    if (['fill', 'clear', 'value', 'empty'].includes(kind))
        candidates = candidates.filter(
            (c) => ['textbox', 'spinbutton'].includes(c.role) && !c.readonly,
        );
    if (kind === 'select')
        candidates = candidates.filter((c) => c.role === 'combobox' || c.tag === 'select');
    if (['check', 'uncheck', 'checked'].includes(kind))
        candidates = candidates.filter((c) => ['checkbox', 'radio', 'switch'].includes(c.role));
    if (kind === 'option')
        candidates = candidates.filter(
            (c) => c.role === 'option' || c.role === 'menuitem' || c.role === 'button',
        );
    const ranked = candidates
        .map((c) => ({ ...c, rank: score(intent, c) }))
        .sort((a, b) => b.rank - a.rank);
    const unique = [];
    for (const c of ranked) {
        // A nested accessible input within its combobox is not a second target.
        if (
            unique.some(
                (x) =>
                    x.name === c.name &&
                    x.context === c.context &&
                    x.role === c.role &&
                    x.frame === c.frame &&
                    x.href === c.href,
            )
        )
            continue;
        unique.push(c);
    }
    if (!unique.length)
        throw new Halt('页面控件不足', `当前页面没有可用于${kind}的控件：${intent}`);
    const shortlist = unique.slice(0, 5);
    if (
        ranked.length >= 2 &&
        ranked[0].rank >= 100 &&
        ranked[1].rank === ranked[0].rank &&
        ranked[0].name === ranked[1].name &&
        ranked[0].context !== ranked[1].context &&
        !norm(intent).includes(norm(ranked[0].context))
    )
        throw new Halt('目标不唯一', `多个区域存在“${intent}”，请在步骤写明记录名称或区域。`);
    const en = /[a-z]/i.test(intent) && !/[\u4e00-\u9fff]/.test(intent);
    const prefix = en
        ? {
              fill: 'Fill ',
              clear: 'Clear ',
              select: 'Select ',
              option: 'Choose ',
              check: 'Check ',
              uncheck: 'Uncheck ',
              hover: 'Hover over ',
              click: 'Click ',
          }[kind] || 'Find '
        : {
              fill: '填写',
              clear: '清空',
              select: '选择',
              option: '选择',
              check: '勾选',
              uncheck: '取消勾选',
              hover: '悬停在',
              click: '点击',
          }[kind] || '查看';
    const keyed = shortlist.map((c, i) => ({
        key:
            c.name.slice(0, 36) +
            (shortlist.filter((x) => x.name === c.name).length > 1
                ? ' [' + (c.context.slice(0, 16) || c.role) + '] #' + i
                : ''),
        control: c,
    }));
    const criteria = Object.fromEntries(
        keyed.map(({ key, control: c }) => [key, prefix + c.name.slice(0, 38)]),
    );
    const stopKey = en ? 'Stop' : '停止';
    criteria[stopKey] = en ? 'Do not perform any action' : '不执行';
    const decision = await laya.choose(prefix + intent, criteria, {
        ...meta,
        phase: 'target',
        url: snap.url,
        candidate_count: snap.controls.length,
        candidates: shortlist.map(({ ref, ...c }) => c),
    });
    if (decision.choice === stopKey)
        throw new Halt('Laya无法判断', `Laya未找到匹配控件：${intent}`);
    const c = keyed.find((x) => x.key === decision.choice)?.control;
    if (!c) throw new Halt('模型结果无效', '模型返回无法映射到当前DOM的目标');
    if (
        (decision.probabilities?.[decision.choice] || 0) < minProbability ||
        decision.margin < minMargin
    )
        throw new Halt('Laya选择不确定', `目标“${intent}”的候选评分或差距不足，停止本步。`);
    const locator = snap.frames[c.frame].locator(`[${ATTR}="${c.ref}"]`);
    if ((await locator.count()) !== 1 || !(await locator.isVisible()))
        throw new Halt('DOM已变化', '决定完成后DOM已变化，当前步骤停止，避免误点。');
    // Distinct identical controls require an explicit row/region, not a guessed index.
    const identical = ranked.filter(
        (x) => x.name === c.name && x.role === c.role && x.context === c.context,
    );
    if (identical.length > 1) {
        let nested = true;
        for (const other of identical) {
            if (other.ref === c.ref) continue;
            const rel = await snap.frames[c.frame].evaluate(
                ({ a, b, attr }) => {
                    const x = document.querySelector(`[${attr}="${a}"]`),
                        y = document.querySelector(`[${attr}="${b}"]`);
                    return x && y && (x.contains(y) || y.contains(x));
                },
                { a: c.ref, b: other.ref, attr: ATTR },
            );
            if (!rel) nested = false;
        }
        if (!nested)
            throw new Halt('目标不唯一', `存在多个同名同上下文控件“${c.name}”，需要补充区域。`);
    }
    return { locator, control: c, decision };
}
export async function settle(page, ms = 250) {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(ms);
    // Avoid networkidle: polling/WebSocket applications may never become idle.
    await page
        .locator('[aria-busy="true"]:visible,.ant-spin-spinning:visible,.el-loading-mask:visible')
        .first()
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});
}
export async function assertionTarget(page, name, kind, { rowKey } = {}) {
    const snap = await observe(page);
    let items = snap.controls.filter((c) => c.role !== 'password');
    if (rowKey) items = items.filter((c) => c.rowKey === rowKey);
    if (['empty', 'value'].includes(kind))
        items = items.filter((c) => ['textbox', 'spinbutton', 'combobox'].includes(c.role));
    if (kind === 'checked')
        items = items.filter((c) => ['checkbox', 'radio', 'switch'].includes(c.role));
    if (kind === 'selected') items = items.filter((c) => c.role === 'tab');
    const exact = items.filter((c) => norm(c.name) === norm(name));
    const matches = exact.length
        ? exact
        : items.filter(
              (c) => norm(c.placeholder) === norm(name) || norm(c.name) === norm('请输入' + name),
          );
    if (matches.length !== 1)
        throw new Halt(
            '断言目标不唯一',
            `预期中的“${name}”对应${matches.length}个明确控件，无法证明断言`,
        );
    const control = matches[0],
        locator = snap.frames[control.frame].locator(`[${ATTR}="${control.ref}"]`);
    return { control, locator };
}
