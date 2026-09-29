export class DecisionContractError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DecisionContractError';
        this.code = code;
    }
}

const fail = (code, message) => {
    throw new DecisionContractError(code, message);
};

export function validateDecision(decision, criteria = null) {
    if (!decision || typeof decision !== 'object')
        fail('invalid-decision', 'Decision must be an object');
    if (typeof decision.provider !== 'string' || !decision.provider)
        fail('invalid-decision', 'decision.provider is required');
    if (typeof decision.model !== 'string' || !decision.model)
        fail('invalid-decision', 'decision.model is required');
    if (typeof decision.choice !== 'string' || !decision.choice)
        fail('invalid-decision', 'decision.choice is required');
    if (!decision.probabilities || typeof decision.probabilities !== 'object')
        fail('invalid-probabilities', 'decision.probabilities is required');

    const keys = Object.keys(decision.probabilities);
    if (!keys.length) fail('invalid-probabilities', 'decision.probabilities is empty');
    if (!Object.hasOwn(decision.probabilities, decision.choice))
        fail('invalid-decision', 'decision.choice is not in probabilities');
    if (criteria) {
        const expected = Object.keys(criteria);
        if (
            keys.length !== expected.length ||
            expected.some((key) => !Object.hasOwn(decision.probabilities, key))
        )
            fail('invalid-probabilities', 'decision.probabilities does not cover criteria');
    }
    for (const key of keys) {
        const value = decision.probabilities[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
            fail('invalid-probabilities', `Invalid probability for ${key}`);
    }
    const sum = keys.reduce((total, key) => total + decision.probabilities[key], 0);
    if (Math.abs(sum - 1) > 0.02)
        fail('invalid-probabilities', `Probabilities sum to ${sum}, expected 1`);
    const values = Object.values(decision.probabilities).sort((a, b) => b - a);
    if (decision.probabilities[decision.choice] < values[0])
        fail('invalid-decision', 'decision.choice is not the highest-probability candidate');
    if (
        decision.confidence !== null &&
        decision.confidence !== undefined &&
        (typeof decision.confidence !== 'number' ||
            !Number.isFinite(decision.confidence) ||
            decision.confidence < 0 ||
            decision.confidence > 1)
    )
        fail('invalid-decision', 'decision.confidence must be between 0 and 1');
    if (
        decision.inference_ms !== undefined &&
        (typeof decision.inference_ms !== 'number' || !Number.isFinite(decision.inference_ms))
    )
        fail('invalid-decision', 'decision.inference_ms must be a finite number');
    return {
        ...decision,
        confidence: decision.confidence ?? null,
        inference_ms: decision.inference_ms ?? 0,
        margin: (values[0] || 0) - (values[1] || 0),
    };
}

export function assertProvider(provider) {
    if (
        !provider ||
        typeof provider.name !== 'string' ||
        typeof provider.warmup !== 'function' ||
        typeof provider.choose !== 'function' ||
        typeof provider.close !== 'function'
    )
        fail('invalid-provider', 'Provider must expose name, warmup, choose, and close');
    return provider;
}
