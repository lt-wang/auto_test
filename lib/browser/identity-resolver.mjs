import { createHash } from 'node:crypto';

export const NO_TABLE_INDEX = -1;
export const NO_ROW_INDEX = -1;

export function stableHash(value) {
    return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

export function resolveRowKey(identity = {}) {
    const hasTableIndex = Number.isInteger(identity.tableIndex);
    const hasRowIndex = Number.isInteger(identity.rowIndex);
    const tableIndex = hasTableIndex ? identity.tableIndex : NO_TABLE_INDEX;
    const rowIndex = hasRowIndex ? identity.rowIndex : NO_ROW_INDEX;
    if ((hasTableIndex && tableIndex < 0) || (hasRowIndex && rowIndex < 0)) return '';
    const explicit = identity.dataRowKey || identity.testId || identity.id;
    if (explicit) return String(explicit);
    if (tableIndex < 0 || rowIndex < 0) return '';
    const text = String(identity.rowText || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return `table-${tableIndex}:row-${rowIndex}`;
    return `table-${tableIndex}:row-${rowIndex}:${stableHash(text)}`;
}
