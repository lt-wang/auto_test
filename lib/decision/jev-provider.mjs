import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { DecisionContractError, validateDecision } from './contract.mjs';

export class JevDecisionProvider {
    constructor({
        apiKey,
        baseURL = 'https://api.typesafe.ai',
        model = 'jev-latest',
        timeout = 30000,
        fetchImpl = fetch,
    } = {}) {
        if (typeof apiKey !== 'string' || !apiKey.trim())
            throw new DecisionContractError('invalid-provider', 'Jev API key is required');
        this.name = 'jev';
        this.model = model;
        this.client = new TypeSafeClient({
            apiKey,
            baseURL,
            defaultModel: model,
            timeout,
            fetch: fetchImpl,
        });
    }

    async warmup() {
        try {
            const models = await this.client.models.list();
            return { provider: this.name, models: models.models?.length ?? models.length ?? 0 };
        } catch (error) {
            throw new DecisionContractError(
                'provider-error',
                `Jev warmup failed: ${error.message}`,
            );
        }
    }

    async choose(state, criteria) {
        const started = performance.now();
        let response;
        try {
            response = await this.client.systemOne({
                state,
                questions: {
                    scenario: choice('用户请求对应哪个操作？', criteria),
                },
            });
        } catch (error) {
            throw new DecisionContractError(
                'provider-error',
                `Jev request failed: ${error.message}`,
            );
        }
        const answer = response?.answers?.scenario;
        if (!answer || answer.type !== 'choice')
            throw new DecisionContractError(
                'invalid-decision',
                'Jev response did not contain a choice answer',
            );
        return validateDecision(
            {
                provider: this.name,
                model: response.model,
                choice: answer.choice,
                probabilities: answer.probabilities,
                confidence: answer.confidence,
                inference_ms: Math.round((performance.now() - started) * 100) / 100,
                usage: response.usage,
            },
            criteria,
        );
    }

    async close() {}
}
