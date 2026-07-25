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
            this.ble = new BLEAdapter(this.runtime, this.extensionId, {
                // Standard Scratch Link 2.x does not support Web Bluetooth's
                // manufacturerData filter shape. Root advertises this service,
                // so one service filter works in Web Bluetooth, Scratch Link,
                // and the Scrub bridge.
                ...ROOT_DISCOVERY_OPTIONS
            }, this.onConnect, this.reset);
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
    RootTransport,
    base64ToBytes,
    bytesToBase64,
    crc8,
    selectBLEAdapter,
    supportsWebBluetooth
};
