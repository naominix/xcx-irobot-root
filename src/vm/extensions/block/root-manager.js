import {RootProtocol, RootTransport} from './root-ble';

/**
 * State and transport for one physical Root. Keeping this state together is
 * important because packet ids and command completion ids restart per Root.
 */
class RootSession {
    constructor (manager, id) {
        this.manager = manager;
        this.id = id;
        this.peripheralId = null;
        this.displayName = `Root ${id}`;
        this.protocol = new RootProtocol();
        this.pendingCommands = new Map();
        this.last = {};
        this.lastDetailedEvent = '';
        this.currentEvent = null;
        this.bumperState = 0;
        this.touchState = 0;
        this.navigationPosition = {x: 0, y: 0, heading: 90};
        this.transport = new RootTransport(
            manager.runtime,
            `${manager.extensionId}:session:${id}`,
            packet => manager.onData(this, packet),
            () => manager.onReset(this),
            () => manager.onConnected(this)
        );
    }

    isConnected () {
        return this.transport.isConnected();
    }
}

/**
 * Facade registered under the public Scratch extension id plus a collection of
 * uniquely registered transports. The facade keeps Scratch's one-extension-id
 * API compatible while each Root gets an independent VM BLE registration.
 */
class RootManager {
    constructor (runtime, extensionId, callbacks) {
        this.runtime = runtime;
        this.extensionId = extensionId;
        this.callbacks = callbacks;
        this.sessions = new Map();
        this.activeSessionId = null;
        this.pendingScanSessionId = null;
        this.nextSessionId = 1;
        runtime.registerPeripheralExtension(extensionId, this);
        this.createSession();
    }

    createSession () {
        const id = this.nextSessionId++;
        const session = new RootSession(this, id);
        this.sessions.set(session.id, session);
        if (this.activeSessionId === null) this.activeSessionId = session.id;
        return session;
    }

    getSession (id) {
        return this.sessions.get(Number(id)) || null;
    }

    getActiveSession () {
        return this.getSession(this.activeSessionId) || this.createSession();
    }

    setActiveSession (id) {
        if (this.sessions.has(Number(id))) this.activeSessionId = Number(id);
        return this.getActiveSession();
    }

    enumerateSessions () {
        return Array.from(this.sessions.values());
    }

    getMenu () {
        return this.enumerateSessions().map(session => ({
            text: session.displayName,
            value: String(session.id)
        }));
    }

    /**
     * Start a scan without interrupting any connected session. The first scan
     * reuses the default disconnected session; subsequent scans create a new
     * session and therefore a new BLE adapter/socket.
     */
    scan () {
        let session = this.getSession(this.pendingScanSessionId);
        if (!session || session.isConnected()) session = this.getActiveSession();
        if (session.isConnected()) session = this.createSession();
        this.pendingScanSessionId = session.id;
        session.transport.scan();
    }

    connect (peripheralId) {
        const session = this.getSession(this.pendingScanSessionId) || this.getActiveSession();
        session.peripheralId = peripheralId;
        session.transport.connect(peripheralId);
    }

    disconnect (sessionId = this.activeSessionId) {
        this.getSession(sessionId).transport.disconnect();
    }

    isConnected (sessionId = this.activeSessionId) {
        return this.getSession(sessionId).isConnected();
    }

    transportMode (sessionId = this.activeSessionId) {
        return this.getSession(sessionId).transport.mode;
    }

    lastConnectionError (sessionId = this.activeSessionId) {
        return this.getSession(sessionId).transport.lastError;
    }

    onConnected (session) {
        session.displayName = `Root ${session.id}`;
        this.pendingScanSessionId = null;
        this.activeSessionId = session.id;
        if (this.callbacks.onConnected) this.callbacks.onConnected(session);
    }

    onReset (session) {
        if (this.pendingScanSessionId === session.id) this.pendingScanSessionId = null;
        if (this.callbacks.onReset) this.callbacks.onReset(session);
    }

    onData (session, packet) {
        if (this.callbacks.onData) this.callbacks.onData(session, packet);
    }
}

export {RootManager, RootSession};
