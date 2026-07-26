import ScratchLinkBLE from '../../io/ble';
import WebBLE from '../../io/ble-web';

const ROOT_SERVICE = '48c5d828-ac2a-442d-97a3-0c9822b04979';
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const ROOT_DISCOVERY_OPTIONS = {
    filters: [{services: [ROOT_SERVICE]}],
    optionalServices: [UART_SERVICE]
};
const SCRUB_DISCOVERY_ACK_TIMEOUT_MS = 1000;
const SCRUB_SESSION_REOPEN_DELAY_MS = 250;
const SCRUB_DISCOVERY_ACK_ATTEMPTS = 30;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

const crc8 = bytes => {
    let crc = 0;
    for (const value of bytes) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
    }
    return crc;
};

const bytesToHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(' ');

// Scratch VM's Base64Util imports the npm `btoa` package, whose browser build
// performs an unguarded Node Buffer check. Buffer is not present in Edge, Safari, or
// WKWebView. Use the browser-native functions directly so command writes work
// in both Web Bluetooth and Scrub.
const bytesToBase64 = bytes => {
    let binary = '';
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary);
};

const base64ToBytes = base64 => {
    const binary = atob(base64);
    return Uint8Array.from(binary, value => value.charCodeAt(0));
};

const supportsWebBluetooth = (navigatorObject = typeof navigator === 'undefined' ? null : navigator) =>
    Boolean(navigatorObject && navigatorObject.bluetooth &&
        typeof navigatorObject.bluetooth.requestDevice === 'function');

const selectBLEAdapter = navigatorObject => supportsWebBluetooth(navigatorObject) ? WebBLE : ScratchLinkBLE;

const isScratchLinkSocketClass = candidate => Boolean(candidate &&
    typeof candidate === 'function' &&
    typeof candidate.isSafariHelperCompatible === 'function' &&
    candidate.isSafariHelperCompatible());

const getScrubSocketClass = (scope = typeof self === 'undefined' ? null : self) => {
    const rootSocket = scope && scope.Scratch && scope.Scratch.iRobotRootScratchLinkSafariSocket;
    if (isScratchLinkSocketClass(rootSocket)) return rootSocket;

    const publishedSocket = scope && scope.Scratch && scope.Scratch.ScratchLinkSafariSocket;
    if (isScratchLinkSocketClass(publishedSocket)) return publishedSocket;

    const globalSocket = scope && scope.ScratchLinkKit && scope.ScratchLinkKit.Socket;
    if (isScratchLinkSocketClass(globalSocket)) return globalSocket;

    // Keep direct access for compatible environments. WKWebView isolates this
    // lexical binding from imported modules, so Scrub exposes the Root-only
    // property above when running the official Xcratch editor.
    try {
        // eslint-disable-next-line no-undef
        const injectedSocket = typeof ScratchLinkKit === 'undefined' ? null : ScratchLinkKit.Socket;
        if (isScratchLinkSocketClass(injectedSocket)) return injectedSocket;
    } catch (error) {
        return null;
    }
    return null;
};

const createScrubSocket = (SocketClass, type) => {
    const socket = new SocketClass(type);
    if (typeof socket._postMessage !== 'function') return socket;

    const postMessage = socket._postMessage.bind(socket);
    let openMessage = null;
    socket._postMessage = message => {
        if (message && message.method === 'open') openMessage = {...message};
        postMessage(message);
    };
    socket.reopenScrubSession = () => {
        if (!openMessage) return false;
        postMessage({...openMessage});
        return true;
    };
    return socket;
};

class RootScratchLinkBLE extends ScratchLinkBLE {
    constructor (runtime, extensionId, peripheralOptions, connectCallback, resetCallback, SocketClass) {
        const isolatedRuntime = {
            constructor: runtime.constructor,
            emit: runtime.emit.bind(runtime),
            getScratchLinkSocket: type => createScrubSocket(SocketClass, type)
        };
        super(isolatedRuntime, extensionId, peripheralOptions, connectCallback, resetCallback);
        this._scrubDiscoveryAckTimer = null;
        this._scrubDiscoveryAttempt = 0;
    }

    requestPeripheral () {
        this._availablePeripherals = {};
        if (this._discoverTimeoutID) window.clearTimeout(this._discoverTimeoutID);
        this._scrubDiscoveryAttempt = 0;
        this._requestPeripheralWhenScrubIsReady();
    }

    _requestPeripheralWhenScrubIsReady () {
        const requestId = this._requestID;
        const request = this.sendRemoteRequest('discover', this._peripheralOptions);
        const attempt = this._scrubDiscoveryAttempt++;

        this._scrubDiscoveryAckTimer = window.setTimeout(() => {
            if (!this._openRequests[requestId]) return;
            delete this._openRequests[requestId];
            if (attempt + 1 < SCRUB_DISCOVERY_ACK_ATTEMPTS) {
                // ScratchLink.swift lazily creates CBCentralManager on the first
                // open request. If its initial state is still unknown, the native
                // BLESession is not created and discover messages are discarded.
                // Reissue open with the same socket ID after CoreBluetooth has had
                // time to settle, then retry discovery on that same socket.
                const reopened = typeof this._socket.reopenScrubSession === 'function' &&
                    this._socket.reopenScrubSession();
                if (reopened) {
                    this._scrubDiscoveryAckTimer = window.setTimeout(
                        this._requestPeripheralWhenScrubIsReady.bind(this),
                        SCRUB_SESSION_REOPEN_DELAY_MS
                    );
                } else {
                    this._requestPeripheralWhenScrubIsReady();
                }
            } else {
                this._handleRequestError(new Error('Scrub BLE session did not become ready'));
                this._handleDiscoverTimeout();
            }
        }, SCRUB_DISCOVERY_ACK_TIMEOUT_MS);

        request.then(() => {
            window.clearTimeout(this._scrubDiscoveryAckTimer);
            this._scrubDiscoveryAckTimer = null;
            this._discoverTimeoutID = window.setTimeout(this._handleDiscoverTimeout.bind(this), 15000);
        }).catch(error => {
            window.clearTimeout(this._scrubDiscoveryAckTimer);
            this._scrubDiscoveryAckTimer = null;
            this._handleRequestError(error);
        });
    }

    disconnect () {
        if (this._scrubDiscoveryAckTimer) {
            window.clearTimeout(this._scrubDiscoveryAckTimer);
            this._scrubDiscoveryAckTimer = null;
        }
        super.disconnect();
    }
}

class RootProtocol {
    constructor () { this.packetId = 0; }

    static hexToBytes (text) {
        const clean = String(text || '').replace(/[^0-9a-f]/gi, '');
        if (clean.length % 2) throw new Error('16進数は2桁単位で指定してください');
        return Uint8Array.from(clean.match(/.{2}/g)?.map(value => parseInt(value, 16)) || []);
    }

    packet (device, command, payload = []) {
        const result = new Uint8Array(20);
        result[0] = device & 0xFF;
        result[1] = command & 0xFF;
        result[2] = this.packetId;
        this.packetId = (this.packetId + 1) & 0xFF;
        result.set(Uint8Array.from(payload).slice(0, 16), 3);
        result[19] = crc8(result.slice(0, 19));
        return result;
    }

    int32Payload (values) {
        const payload = new Uint8Array(values.length * 4);
        const view = new DataView(payload.buffer);
        values.forEach((value, index) => view.setInt32(index * 4, Math.round(value), false));
        return payload;
    }

    motors (left, right) { return this.packet(1, 4, this.int32Payload([clamp(left, -100, 100), clamp(right, -100, 100)])); }
    driveDistance (distanceMm) { return this.packet(1, 8, this.int32Payload([distanceMm])); }
    rotate (angleDeciDegrees) { return this.packet(1, 12, this.int32Payload([angleDeciDegrees])); }
    driveArc (angleDeciDegrees, radiusMm) { return this.packet(1, 27, this.int32Payload([angleDeciDegrees, radiusMm])); }
    led (state, red, green, blue) {
        return this.packet(3, 2, [clamp(state, 0, 3), clamp(red, 0, 255), clamp(green, 0, 255), clamp(blue, 0, 255)]);
    }

    note (frequency, durationMs) {
        const payload = new Uint8Array(6);
        const view = new DataView(payload.buffer);
        view.setUint32(0, clamp(frequency, 0, 0xFFFFFFFF), false);
        view.setUint16(4, clamp(durationMs, 0, 0xFFFF), false);
        return this.packet(5, 0, payload);
    }

    decode (packet) {
        const bytes = Uint8Array.from(packet);
        if (bytes.length !== 20 || crc8(bytes.slice(0, 19)) !== bytes[19]) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const result = {device: bytes[0], command: bytes[1], packetId: bytes[2], raw: bytesToHex(bytes)};
        if (bytes[0] === 14 && (bytes[1] === 0 || bytes[1] === 1)) {
            result.batteryMv = view.getUint16(7, false); result.batteryPercent = bytes[9];
        } else if (bytes[0] === 12 && bytes[1] === 0) {
            result.leftBumper = Boolean(bytes[7] & 0x80); result.rightBumper = Boolean(bytes[7] & 0x40);
        } else if (bytes[0] === 17 && bytes[1] === 0) {
            result.touchMask = bytes[7] >> 4;
        } else if (bytes[0] === 20 && bytes[1] === 0) {
            result.cliff = Boolean(bytes[7]);
        } else if (bytes[0] === 16 && bytes[1] === 1) {
            result.accelX = view.getInt16(7, false); result.accelY = view.getInt16(9, false); result.accelZ = view.getInt16(11, false);
        } else if (bytes[0] === 13 && (bytes[1] === 0 || bytes[1] === 1)) {
            result.lightLeft = view.getUint16(7, false); result.lightRight = view.getUint16(9, false);
        }
        return result;
    }
}

class RootTransport {
    constructor (runtime, extensionId, onData) {
        this.runtime = runtime;
        this.extensionId = extensionId;
        this.onData = onData;
        this.ble = null;
        this.mode = supportsWebBluetooth() ? 'Web Bluetooth' : 'Scratch Link / Scrub';
        this.lastError = '';
        this.runtime.registerPeripheralExtension(extensionId, this);
        this.onConnect = this.onConnect.bind(this);
        this.reset = this.reset.bind(this);
        this._registerRuntimeDiagnostics();
    }

    scan () {
        if (this.ble) this.ble.disconnect();
        this.lastError = '';
        const BLEAdapter = selectBLEAdapter();
        try {
            const options = {
                // Standard Scratch Link 2.x does not support Web Bluetooth's
                // manufacturerData filter shape. Root advertises this service,
                // so one service filter works in Web Bluetooth, Scratch Link,
                // and the Scrub bridge.
                ...ROOT_DISCOVERY_OPTIONS
            };
            const ScrubSocket = BLEAdapter === ScratchLinkBLE ? getScrubSocketClass() : null;
            this.ble = ScrubSocket ?
                new RootScratchLinkBLE(
                    this.runtime, this.extensionId, options, this.onConnect, this.reset, ScrubSocket
                ) :
                new BLEAdapter(this.runtime, this.extensionId, options, this.onConnect, this.reset);
        } catch (error) {
            this.setError(error);
            throw error;
        }
    }

    connect (peripheralId) {
        if (this.ble) this.ble.connectPeripheral(peripheralId);
    }

    onConnect () {
        this.ble.startNotifications(UART_SERVICE, TX, message => {
            this.onData(base64ToBytes(message));
        });
    }

    write (bytes) {
        if (!this.isConnected()) return Promise.reject(new Error('Rootに接続してください'));
        return this.ble.write(UART_SERVICE, RX, bytesToBase64(bytes), 'base64', false)
            .catch(error => {
                this.setError(error);
                throw error;
            });
    }

    disconnect () {
        if (this.ble) this.ble.disconnect();
        this.reset();
    }

    reset () { this.lastError = ''; }
    setError (error) {
        this.lastError = error && error.message ? error.message : String(error || 'BLE通信エラー');
    }
    _registerRuntimeDiagnostics () {
        if (!this.runtime.on) return;
        const RuntimeClass = this.runtime.constructor;
        this.runtime.on(RuntimeClass.PERIPHERAL_CONNECTED, () => {
            this.lastError = '';
        });
        this.runtime.on(RuntimeClass.PERIPHERAL_REQUEST_ERROR, details => {
            if (!details || !details.extensionId || details.extensionId === this.extensionId) {
                this.lastError = `${this.mode}: BLE接続要求に失敗しました`;
            }
        });
        this.runtime.on(RuntimeClass.PERIPHERAL_SCAN_TIMEOUT, () => {
            this.lastError = `${this.mode}: Rootが見つかりませんでした`;
        });
        this.runtime.on(RuntimeClass.PERIPHERAL_CONNECTION_LOST_ERROR, details => {
            if (!details || !details.extensionId || details.extensionId === this.extensionId) {
                this.lastError = `${this.mode}: Rootとの接続が失われました`;
            }
        });
    }
    isConnected () { return Boolean(this.ble && this.ble.isConnected()); }
}

export {
    ROOT_DISCOVERY_OPTIONS,
    RootProtocol,
    RootScratchLinkBLE,
    RootTransport,
    SCRUB_DISCOVERY_ACK_ATTEMPTS,
    SCRUB_DISCOVERY_ACK_TIMEOUT_MS,
    SCRUB_SESSION_REOPEN_DELAY_MS,
    base64ToBytes,
    bytesToBase64,
    createScrubSocket,
    crc8,
    getScrubSocketClass,
    selectBLEAdapter,
    supportsWebBluetooth
};
