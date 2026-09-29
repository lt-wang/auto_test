import { SessionRegistry } from './session-registry.mjs';
import { target } from './dom.mjs';

const visiblePasswords = async (session) =>
    (await session.snapshot()).controls.filter(
        (control) => control.role === 'password' && control.visible,
    );

export async function loginRoleSession(session, laya, role, user, password) {
    let passwords = await visiblePasswords(session);
    if (passwords.length !== 1)
        throw Error(`角色 ${role} 的登录页密码框数量为 ${passwords.length}`);
    const account = await target(session, laya, '账号 Account Username', { kind: 'fill' });
    await account.locator.fill(user);
    await session.act({ kind: 'fill', ref: passwords[0].ref, value: password });
    const login = await target(session, laya, '登录 Login Sign in');
    await login.locator.click();
    const started = Date.now();
    while ((await visiblePasswords(session)).length && Date.now() - started < 30000)
        await session.settle(100);
    if ((await visiblePasswords(session)).length) throw Error(`角色 ${role} 登录未完成`);
}

export function createRoleRegistry(config, { base, url, laya, readSecret, openSession }) {
    return new SessionRegistry({
        base,
        createSession: async (roleName) => {
            const role = config.roles?.[roleName];
            if (!role) throw Error('未配置角色：' + roleName);
            const session = await openSession();
            await session.navigate(url);
            const user = role.userEnv ? process.env[role.userEnv] : '';
            if (user) {
                const password = await readSecret(`角色 ${roleName} 密码`, role.passwordEnv || '');
                await loginRoleSession(session, laya, roleName, user, password);
            } else if (role.manualLogin) {
                throw Error(`角色 ${roleName} 需要人工登录，暂不能作为自动角色会话`);
            }
            return session;
        },
    });
}
