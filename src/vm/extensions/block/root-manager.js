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
        // null means the adapter has not reported a lifecycle transition yet;
        // explicit false prevents a stale adapter/socket state from making a
        // disconnected slot look occupied during the next scan.
        this.connectionState = null;
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
        if (this.connectionState === false) return false;
        const connected = this.transport.isConnected();
        if (connected) this.connectionState = true;
        return connected;
    }

    clearConnectionState () {
        // Keep the numbered session itself so projects already containing a
        // "use Root 2" block remain valid after the reset. Only the physical
        // connection and data tied to the former robot are discarded.
        this.peripheralId = null;
        this.connectionState = false;
        this.protocol = new RootProtocol();
        this.last = {};
        this.lastDetailedEvent = '';
        this.currentEvent = null;
        this.bumperState = 0;
        this.touchState = 0;
        this.navigationPosition = {x: 0, y: 0, heading: 90};
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
        if (!session || session.isConnected()) {
            const active = this.getActiveSession();
            session = active.isConnected() ?
                this.enumerateSessions().find(candidate => !candidate.isConnected()) : active;
        }
        // Reuse a disconnected slot so reconnecting a Root does not grow the
        // menu from Root 1/2 to Root 3/4. A new session is created only when
        // every existing Root is currently connected.
        if (!session) session = this.createSession();
        this.pendingScanSessionId = session.id;
        session.transport.scan();
    }

    connect (peripheralId) {
        const session = this.getSession(this.pendingScanSessionId) || this.getActiveSession();
        session.peripheralId = peripheralId;
        session.transport.connect(peripheralId);
    }

    disconnect (sessionId = this.activeSessionId) {
        const session = this.getSession(sessionId);
        if (!session) return;
        session.connectionState = false;
        session.transport.disconnect();
    }

    resetConnections () {
        const sessions = this.enumerateSessions();
        // Disconnect every session before clearing state. RootTransport.reset
        // invokes the extension callback, allowing pending Scratch commands to
        // be cancelled rather than left waiting for a completion packet.
        for (const session of sessions) this.disconnect(session.id);
        for (const session of sessions) session.clearConnectionState();
        this.pendingScanSessionId = null;
        this.activeSessionId = sessions.length ? sessions[0].id : null;
        if (this.activeSessionId === null) this.createSession();
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
        session.connectionState = true;
        session.displayName = `Root ${session.id}`;
        this.pendingScanSessionId = null;
        this.activeSessionId = session.id;
        if (this.callbacks.onConnected) this.callbacks.onConnected(session);
    }

    onReset (session) {
        session.connectionState = false;
        if (this.pendingScanSessionId === session.id) this.pendingScanSessionId = null;
        if (this.callbacks.onReset) this.callbacks.onReset(session);
    }

    onData (session, packet) {
        if (this.callbacks.onData) this.callbacks.onData(session, packet);
    }
}

export {RootManager, RootSession};
