export class SessionRegistry {
    constructor({ base = null, createSession = null } = {}) {
        this.sessions = new Map();
        this.createSession = createSession;
        if (base) this.sessions.set('default', base);
    }

    set(name, session) {
        this.sessions.set(name, session);
        return session;
    }

    async get(name = 'default') {
        if (this.sessions.has(name)) return this.sessions.get(name);
        if (!this.createSession) throw Error('没有配置角色会话工厂：' + name);
        const session = await this.createSession(name);
        this.sessions.set(name, session);
        return session;
    }

    async close() {
        const unique = [...new Set(this.sessions.values())];
        this.sessions.clear();
        await Promise.all(unique.map((session) => session.close().catch(() => {})));
    }
}
