import { createHash } from 'node:crypto';

export function stableHash(value) {
    return createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

export function resolveRowKey(identity = {}) {
    const explicit = identity.dataRowKey || identity.testId || identity.id;
    if (explicit) return String(explicit);
    const tableIndex = Number.isInteger(identity.tableIndex) ? identity.tableIndex : 0;
    const rowIndex = Number.isInteger(identity.rowIndex) ? identity.rowIndex : 0;
    const text = String(identity.rowText || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return `table-${tableIndex}:row-${rowIndex}`;
    return `table-${tableIndex}:row-${rowIndex}:${stableHash(text)}`;
}
