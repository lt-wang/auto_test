import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateWorkflow } from './workflow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildRebindFile(editable, bindings) {
    const byId = new Map((bindings?.cases || []).map((item) => [item.id, item]));
    const changed = [];
    const cases = [];
    for (const row of editable.rows || []) {
        if (row.changed) changed.push(row.id);
        const supplied = byId.get(row.id);
        if (row.changed && !supplied)
            throw Error(`用例 ${row.id} 的可见步骤已修改，但没有提供重新绑定`);
        cases.push(supplied || row.case);
    }
    const file = {
        schemaVersion: editable.schemaVersion,
        generatedAt: new Date().toISOString(),
        moduleUrl: editable.moduleUrl,
        coverage: editable.coverage || [],
        cases,
    };
    return { file: validateWorkflow(file), changed };
}

function command(config, action, payload) {
    return new Promise((resolve, reject) => {
        const child = spawn(config.python, [path.join(ROOT, 'lib', 'workflow_excel.py'), action], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => (stdout += data));
        child.stderr.on('data', (data) => (stderr += data));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) return reject(Error(stderr.trim() || `Excel ${action} failed`));
            try {
                resolve(stdout.trim() ? JSON.parse(stdout) : null);
            } catch {
                reject(Error(`Excel ${action} returned invalid JSON`));
            }
        });
        child.stdin.end(JSON.stringify(payload));
    });
}

export async function runRebind(config) {
    if (!config.caseFile) throw Error('重新绑定需要 --case-file');
    if (!config.bindings) throw Error('重新绑定需要 --bindings');
    const editable = await command(config, 'read_editable', {
        path: path.resolve(config.caseFile),
    });
    const bindings = JSON.parse(await fs.readFile(path.resolve(config.bindings), 'utf8'));
    const { file, changed } = buildRebindFile(editable, bindings);
    const output = path.resolve(
        config.output || config.caseFile.replace(/\\.xlsx$/i, '.rebound.xlsx'),
    );
    await command(config, 'write', {
        path: output,
        template: config.caseFile,
        file,
    });
    await fs.writeFile(
        path.join(config.out, 'rebind-report.json'),
        JSON.stringify(
            { source: config.caseFile, output, changed, cases: file.cases.length },
            null,
            2,
        ),
    );
    return { mode: 'rebind', output, changed, cases: file.cases.length };
}
