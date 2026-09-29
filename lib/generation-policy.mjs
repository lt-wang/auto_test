export class GenerationPolicyError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'GenerationPolicyError';
        this.code = code;
    }
}

export const GENERATION_OPERATIONS = [
    'tabs',
    'tab-switch',
    'table',
    'filters',
    'form-validation',
    'form-invalid',
    'create',
    'search',
    'view',
    'edit',
    'delete',
];

const POLICY_KEYS = new Set([
    'allowedOperations',
    'cleanup',
    'recordPrefix',
    'maxRecords',
    'allowedDataKeys',
]);
const CLEANUP_MODES = new Set(['delete-case', 'never']);
const fail = (code, message) => {
    throw new GenerationPolicyError(code, message);
};

export class GenerationPolicy {
    constructor(config, { allowWrite = false } = {}) {
        this.allowedOperations = new Set(config.allowedOperations);
        this.cleanup = config.cleanup;
        this.recordPrefix = config.recordPrefix;
        this.maxRecords = config.maxRecords;
        this.allowedDataKeys = config.allowedDataKeys;
        this.allowWrite = Boolean(allowWrite);
    }

    allowsOperation(operation) {
        return this.allowedOperations.has(operation);
    }

    assertOperation(operation) {
        if (!this.allowsOperation(operation))
            fail('operation-denied', `Generation policy does not allow operation: ${operation}`);
        return true;
    }

    canWrite() {
        return this.allowWrite;
    }

    assertWriteAllowed(action) {
        if (!this.allowWrite)
            fail('write-denied', `Generation policy does not allow write action: ${action}`);
        return true;
    }

    shouldCleanup() {
        return this.cleanup === 'delete-case';
    }

    assertRecordLimit(count) {
        if (count >= this.maxRecords)
            fail('record-limit', `Generation policy maxRecords reached: ${this.maxRecords}`);
        return true;
    }

    assertFixtureKey(key) {
        if (this.allowedDataKeys && !this.allowedDataKeys.has(key))
            fail('data-denied', `Fixture key is not in allowedDataKeys: ${key}`);
        return true;
    }

    recordName(timestamp = Date.now(), random = Math.random().toString(16).slice(2, 8)) {
        const suffix = String(random)
            .replace(/[^a-z0-9]/gi, '')
            .slice(0, 8);
        return `${this.recordPrefix}_${timestamp}_${suffix}`;
    }
}

export function createGenerationPolicy(input = null, options = {}) {
    const source = input || {};
    if (!source || Array.isArray(source) || typeof source !== 'object')
        fail('invalid-policy', 'generation policy must be a JSON object');
    for (const key of Object.keys(source))
        if (!POLICY_KEYS.has(key)) fail('invalid-policy', `Unknown generation policy key: ${key}`);

    const allowedOperations = source.allowedOperations ?? GENERATION_OPERATIONS;
    if (
        !Array.isArray(allowedOperations) ||
        !allowedOperations.length ||
        allowedOperations.some((operation) => !GENERATION_OPERATIONS.includes(operation))
    )
        fail('invalid-policy', 'allowedOperations contains an unsupported operation');

    const cleanup = source.cleanup ?? 'delete-case';
    if (!CLEANUP_MODES.has(cleanup)) fail('invalid-policy', 'cleanup must be delete-case or never');

    const recordPrefix = source.recordPrefix ?? 'LayaAuto';
    if (typeof recordPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(recordPrefix))
        fail(
            'invalid-policy',
            'recordPrefix must start with a letter and contain only letters, digits, _ or -',
        );

    const maxRecords = source.maxRecords ?? 100;
    if (!Number.isInteger(maxRecords) || maxRecords <= 0)
        fail('invalid-policy', 'maxRecords must be a positive integer');

    const allowedDataKeys = source.allowedDataKeys ?? null;
    if (
        allowedDataKeys !== null &&
        (!Array.isArray(allowedDataKeys) ||
            !allowedDataKeys.length ||
            allowedDataKeys.some((key) => typeof key !== 'string' || !key.trim()))
    )
        fail('invalid-policy', 'allowedDataKeys must be a non-empty string array');

    return new GenerationPolicy(
        {
            allowedOperations: [...new Set(allowedOperations)],
            cleanup,
            recordPrefix,
            maxRecords,
            allowedDataKeys: allowedDataKeys ? new Set(allowedDataKeys) : null,
        },
        options,
    );
}
