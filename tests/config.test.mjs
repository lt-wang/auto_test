import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    configured,
    configuredFlag,
    loadProjectConfig,
    loadLocalEnvironment,
} from '../lib/project-config.mjs';
import { openBrowser } from '../lib/browser-provider.mjs';

test('CLI, environment, config and defaults have explicit precedence', () => {
    const arg = (name) => (name === '--url' ? 'https://cli.example/test' : undefined);
    process.env.TEST_CONFIG_URL = 'https://env.example/test';
    try {
        assert.equal(
            configured(
                arg,
                '--url',
                'TEST_CONFIG_URL',
                'https://file.example/test',
                'https://default.example/test',
            ),
            'https://cli.example/test',
        );
        assert.equal(
            configured(
                () => undefined,
                '--url',
                'TEST_CONFIG_URL',
                'https://file.example/test',
                'https://default.example/test',
            ),
            'https://env.example/test',
        );
        delete process.env.TEST_CONFIG_URL;
        assert.equal(
            configured(
                () => undefined,
                '--url',
                'TEST_CONFIG_URL',
                'https://file.example/test',
                'https://default.example/test',
            ),
            'https://file.example/test',
        );
        assert.equal(configuredFlag(['--headed'], '--headless', null, true), false);
    } finally {
        delete process.env.TEST_CONFIG_URL;
    }
});

test('project config rejects credentials and unknown keys', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-pilot-config-'));
    try {
        const file = path.join(dir, 'config.json');
        await fs.writeFile(
            file,
            JSON.stringify({ url: 'http://127.0.0.1:8765/customers', provider: 'local' }),
        );
        assert.equal((await loadProjectConfig(file)).provider, 'local');
        await fs.writeFile(
            file,
            JSON.stringify({
                provider: 'local',
                generation: { allowedOperations: ['create', 'search'], cleanup: 'never' },
            }),
        );
        assert.deepEqual((await loadProjectConfig(file)).generation.allowedOperations, [
            'create',
            'search',
        ]);
        await fs.writeFile(
            file,
            JSON.stringify({ url: 'http://127.0.0.1:8765/customers', password: 'secret' }),
        );
        await assert.rejects(loadProjectConfig(file), /Unknown config keys: password/);
        await fs.writeFile(file, JSON.stringify({ apiKey: 'secret' }));
        await assert.rejects(loadProjectConfig(file), /Unknown config keys: apiKey/);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('local environment is parsed without evaluating shell code, and shell values win', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-pilot-env-'));
    const priorUser = process.env.TEST_USER,
        priorPassword = process.env.TEST_PASSWORD;
    try {
        process.env.TEST_USER = 'shell-user';
        delete process.env.TEST_PASSWORD;
        await fs.writeFile(
            path.join(dir, '.env.local'),
            "TEST_USER=file-user\nTEST_PASSWORD='fixture-password'\n",
        );
        await loadLocalEnvironment(dir);
        assert.equal(process.env.TEST_USER, 'shell-user');
        assert.equal(process.env.TEST_PASSWORD, 'fixture-password');
        await fs.writeFile(
            path.join(dir, '.env.local'),
            'TEST_PASSWORD=$(echo unsafe)\nUNEXPECTED=1\n',
        );
        await assert.rejects(loadLocalEnvironment(dir), /Invalid .env.local entry on line 2/);
    } finally {
        if (priorUser === undefined) delete process.env.TEST_USER;
        else process.env.TEST_USER = priorUser;
        if (priorPassword === undefined) delete process.env.TEST_PASSWORD;
        else process.env.TEST_PASSWORD = priorPassword;
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('unimplemented browser backends fail before opening a browser', async () => {
    await assert.rejects(
        openBrowser({ browserProvider: 'browser-use' }),
        /Unsupported browser provider/,
    );
});

test('TypeSafe Jev environment variables are accepted without entering JSON config', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laya-pilot-jev-env-'));
    const keys = ['TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_DEFAULT_MODEL'];
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
        for (const key of keys) delete process.env[key];
        await fs.writeFile(
            path.join(dir, '.env.local'),
            'TYPESAFE_API_KEY=jev-secret\nTYPESAFE_BASE_URL=https://api.typesafe.ai\nTYPESAFE_DEFAULT_MODEL=jev-latest\n',
        );
        await loadLocalEnvironment(dir);
        assert.equal(process.env.TYPESAFE_API_KEY, 'jev-secret');
        assert.equal(process.env.TYPESAFE_BASE_URL, 'https://api.typesafe.ai');
        assert.equal(process.env.TYPESAFE_DEFAULT_MODEL, 'jev-latest');

        const file = path.join(dir, 'config.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                provider: 'jev',
                jevBase: 'https://api.typesafe.ai',
                jevModel: 'jev-latest',
            }),
        );
        assert.equal((await loadProjectConfig(file)).provider, 'jev');
        await fs.writeFile(file, JSON.stringify({ provider: 'jev', typesafeApiKey: 'secret' }));
        await assert.rejects(loadProjectConfig(file), /Unknown config keys: typesafeApiKey/);
    } finally {
        for (const key of keys) {
            if (prior[key] === undefined) delete process.env[key];
            else process.env[key] = prior[key];
        }
        await fs.rm(dir, { recursive: true, force: true });
    }
});
