import { Halt } from './language.mjs';

export async function waitForReady(source, options = {}) {
    if (typeof source?.waitForReady === 'function' && source !== source.waitForReady)
        return source.waitForReady(options);
    const { waitForReady: waitForReadyPage } = await import('./browser/playwright-readiness.mjs');
    return waitForReadyPage(source, options);
}

export async function switchLanguage(source, language) {
    if (source?.snapshot && source?.act) return '语言切换由后端适配器负责';
    const { switchLanguage: switchLanguagePage } =
        await import('./browser/playwright-readiness.mjs');
    return switchLanguagePage(source, language);
}

export async function readTables(source) {
    if (source?.snapshot) {
        const snapshot = await source.snapshot();
        const tables = (snapshot.tables || []).map((table) => ({
            headers: table.headers || [],
            rows: table.rows || [],
        }));
        const width = Math.max(0, ...tables.map((table) => table.headers.length));
        const full = tables.filter((table) => table.headers.length === width);
        if (!full.length) return { headers: [], rows: [] };
        const distinct = new Map(full.map((table) => [JSON.stringify(table), table]));
        if (distinct.size !== 1)
            throw new Halt('表格不唯一', '存在多个不同的数据表，无法判断目标表格');
        return [...distinct.values()][0];
    }
    const { readTablesPage } = await import('./browser/playwright-readiness.mjs');
    return readTablesPage(source);
}
