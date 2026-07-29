import {COMMAND_FINISH_TIMEOUT_MS, blockClass} from '../../src/vm/extensions/block/index.js';
import {
    ROOT_DISCOVERY_OPTIONS,
    RootProtocol,
    RootScratchLinkBLE,
    RootTransport,
    SCRUB_DISCOVERY_ACK_TIMEOUT_MS,
    base64ToBytes,
    bytesToBase64,
    crc8,
    getScrubSocketClass,
    selectBLEAdapter,
    supportsWebBluetooth
} from '../../src/vm/extensions/block/root-ble.js';

describe('iRobot Root extension', () => {
    const formatMessage = msg => msg.default;
    formatMessage.setup = () => ({locale: 'ja', translations: {ja: {}}});
    const runtime = {formatMessage, registerPeripheralExtension: jest.fn(), startHats: jest.fn()};

    beforeEach(() => {
        runtime.registerPeripheralExtension.mockClear();
        runtime.startHats.mockClear();
    });

    test('exposes the official Xcratch block class metadata', () => {
        const block = new blockClass(runtime);
        expect(block).toBeInstanceOf(blockClass);
        expect(block.getInfo().id).toBe('irobotRoot');
        expect(block.getInfo().blocks.some(item => item.opcode === 'connect')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'ledAnimation')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenBumper')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenTouchSensor')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenFLTouch')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenBothBumpersRelease')).toBe(true);
        expect(block.whenBumper()).toBe(true);
        expect(block.whenTouchSensor()).toBe(true);
        expect(block.whenFixedEvent()).toBe(true);
        expect(runtime.registerPeripheralExtension).toHaveBeenCalledWith('irobotRoot', block.transport);
    });

    test('updates block and menu labels when Scratch changes between Japanese and English', () => {
        const localeSetup = {locale: 'ja', translations: {ja: {}, en: {}}};
        const localizedFormatMessage = message =>
            localeSetup.translations[localeSetup.locale][message.id] || message.default;
        localizedFormatMessage.setup = () => localeSetup;
        const localizedRuntime = Object.assign({}, runtime, {formatMessage: localizedFormatMessage});
        const block = new blockClass(localizedRuntime);
        const findBlock = (info, opcode) => info.blocks.find(item => item.opcode === opcode);

        const japaneseInfo = block.getInfo();
        expect(findBlock(japaneseInfo, 'connect').text).toBe('Rootに接続する');
        expect(findBlock(japaneseInfo, 'motors').text).toBe('左モーター [LEFT] 右モーター [RIGHT]');
        expect(findBlock(japaneseInfo, 'whenFLTouch').text).toBe('FLタッチセンサーに触れたとき');
        expect(japaneseInfo.menus.markerMenu.items[0]).toEqual({text: '上げる', value: '0'});

        localeSetup.locale = 'en-US';
        const englishInfo = block.getInfo();
        expect(findBlock(englishInfo, 'connect').text).toBe('connect to Root');
        expect(findBlock(englishInfo, 'motors').text).toBe('set left motor [LEFT] right motor [RIGHT]');
        expect(findBlock(englishInfo, 'whenFLTouch').text).toBe('when FL touch sensor is touched');
        expect(englishInfo.menus.markerMenu.items[0]).toEqual({text: 'up', value: '0'});
    });

    test('matches the documented motor packet and CRC', () => {
        const protocol = new RootProtocol();
        const packet = protocol.motors(100, 100);
        expect(Array.from(packet)).toEqual([
            1, 4, 0, 0, 0, 0, 100, 0, 0, 0, 100,
            0, 0, 0, 0, 0, 0, 0, 0, 0xD1
        ]);
        expect(crc8(packet.slice(0, 19))).toBe(0xD1);
    });

    test('packet IDs wrap after 255', () => {
        const protocol = new RootProtocol();
        for (let id = 0; id < 256; id++) expect(protocol.packet(0, 0)[2]).toBe(id);
        expect(protocol.packet(0, 0)[2]).toBe(0);
    });

    test('selects Web Bluetooth at runtime instead of at bundle time', () => {
        const webNavigator = {bluetooth: {requestDevice: jest.fn()}};
        expect(supportsWebBluetooth(webNavigator)).toBe(true);
        expect(selectBLEAdapter(webNavigator).name).toBe('WebBLE');
        expect(supportsWebBluetooth({})).toBe(false);
        expect(selectBLEAdapter({}).name).toBe('BLE');
    });

    test('uses Scrub internal socket without requiring Scrub to publish it for Xcratch', () => {
        class FakeSocket {
            static isSafariHelperCompatible () { return true; }
        }
        const originalScratchLinkKit = global.ScratchLinkKit;
        try {
            global.ScratchLinkKit = {Socket: FakeSocket};
            expect(getScrubSocketClass({})).toBe(FakeSocket);
        } finally {
            global.ScratchLinkKit = originalScratchLinkKit;
        }
    });

    test('prefers an officially published Scrub socket and leaves it unchanged', () => {
        class PublishedSocket {
            static isSafariHelperCompatible () { return true; }
        }
        const scope = {Scratch: {ScratchLinkSafariSocket: PublishedSocket}};
        expect(getScrubSocketClass(scope)).toBe(PublishedSocket);
        expect(scope.Scratch.ScratchLinkSafariSocket).toBe(PublishedSocket);
    });

    test('retries discovery on the same Scrub socket while Bluetooth permission is pending', async () => {
        jest.useFakeTimers();
        const originalWindow = global.window;
        const originalCloseEvent = global.CloseEvent;
        global.window = global;
        global.CloseEvent = class CloseEvent {};
        class FakeSocket {
            static instances = [];
            static isSafariHelperCompatible () { return true; }
            constructor () {
                this.opened = false;
                this.messages = [];
                FakeSocket.instances.push(this);
            }
            setOnOpen (callback) { this.onOpen = callback; }
            setOnClose (callback) { this.onClose = callback; }
            setOnError (callback) { this.onError = callback; }
            setHandleMessage (callback) { this.onMessage = callback; }
            open () {
                this.opened = true;
                window.setTimeout(this.onOpen, 100);
            }
            close () {
                this.opened = false;
                this.onClose(new CloseEvent('close'));
            }
            isOpen () { return this.opened; }
            sendMessage (message) { this.messages.push(message); }
            respond (message) { this.onMessage(message); }
        }
        const RuntimeClass = {
            PERIPHERAL_CONNECTED: 'connected',
            PERIPHERAL_CONNECTION_LOST_ERROR: 'lost',
            PERIPHERAL_DISCONNECTED: 'disconnected',
            PERIPHERAL_LIST_UPDATE: 'list',
            PERIPHERAL_REQUEST_ERROR: 'requestError',
            PERIPHERAL_SCAN_TIMEOUT: 'scanTimeout',
            USER_PICKED_PERIPHERAL: 'picked'
        };
        const isolatedRuntime = {constructor: RuntimeClass, emit: jest.fn()};
        try {
            const ble = new RootScratchLinkBLE(
                isolatedRuntime, 'irobotRoot', ROOT_DISCOVERY_OPTIONS, jest.fn(), jest.fn(), FakeSocket
            );
            const socket = FakeSocket.instances[0];

            jest.advanceTimersByTime(100);
            expect(socket.messages).toHaveLength(1);
            expect(socket.messages[0].method).toBe('discover');

            jest.advanceTimersByTime(SCRUB_DISCOVERY_ACK_TIMEOUT_MS);
            expect(socket.messages).toHaveLength(2);
            expect(socket.isOpen()).toBe(true);

            socket.respond({jsonrpc: '2.0', id: socket.messages[1].id, result: null});
            await Promise.resolve();
            jest.advanceTimersByTime(SCRUB_DISCOVERY_ACK_TIMEOUT_MS * 2);
            expect(socket.messages).toHaveLength(2);
            expect(ble._openRequests[0]).toBeUndefined();
            expect(ble._openRequests[1]).toBeUndefined();

            ble.disconnect();
        } finally {
            global.window = originalWindow;
            global.CloseEvent = originalCloseEvent;
            jest.useRealTimers();
        }
    });

    test('uses discovery options accepted by Web Bluetooth and Scratch Link 2.x', () => {
        expect(ROOT_DISCOVERY_OPTIONS).toEqual({
            filters: [{services: ['48c5d828-ac2a-442d-97a3-0c9822b04979']}],
            optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e']
        });
        expect(ROOT_DISCOVERY_OPTIONS.filters[0].manufacturerData).toBeUndefined();
    });

    test('does not wait for a BLE write response before finishing a command block', async () => {
        const block = new blockClass(runtime);
        let resolveWrite;
        block.transport.write = jest.fn(() => new Promise(resolve => {
            resolveWrite = resolve;
        }));

        expect(block.motors({LEFT: 10, RIGHT: 20})).toBeUndefined();
        expect(block.transport.write).toHaveBeenCalledTimes(1);
        resolveWrite();
        await Promise.resolve();
    });

    test.each([
        ['drive', {MM: 100}, 8],
        ['turn', {DEGREES: 90}, 12],
        ['arc', {RADIUS: 100, DEGREES: 90}, 27]
    ])('%s waits for Root finished response with the matching packet ID', async (method, args, command) => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block[method](args);
        const packet = block.transport.write.mock.calls[0][0];
        let completed = false;
        completion.then(() => {
            completed = true;
        });

        await Promise.resolve();
        expect(completed).toBe(false);
        expect(packet[0]).toBe(1);
        expect(packet[1]).toBe(command);

        const wrongId = new RootProtocol().packet(1, command);
        wrongId[2] = (packet[2] + 1) & 0xFF;
        wrongId[19] = crc8(wrongId.slice(0, 19));
        block._receive(wrongId);
        await Promise.resolve();
        expect(completed).toBe(false);

        const finished = new RootProtocol().packet(1, command);
        finished[2] = packet[2];
        finished[19] = crc8(finished.slice(0, 19));
        block._receive(finished);
        await expect(completion).resolves.toBeUndefined();
        expect(completed).toBe(true);
    });

    test('reports a timeout when Root never sends a finished response', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block.drive({MM: 100});
        const rejected = expect(completion).rejects.toThrow('Root command timed out');

        jest.advanceTimersByTime(COMMAND_FINISH_TIMEOUT_MS);
        await rejected;
        expect(block.lastConnectionError()).toContain('command 8');
        expect(block.pendingCommands.size).toBe(0);
        jest.useRealTimers();
    });

    test('cancels a pending movement when the connection resets', async () => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block.turn({DEGREES: 90});
        const rejected = expect(completion).rejects.toThrow('Root connection was reset');

        block.transport.reset();
        await rejected;
        expect(block.pendingCommands.size).toBe(0);
    });

    test('writes Root UART packets without requesting a BLE response', async () => {
        const transport = Object.create(RootTransport.prototype);
        transport.lastError = '';
        transport.ble = {
            isConnected: () => true,
            write: jest.fn(() => Promise.resolve(20))
        };
        await transport.write(Uint8Array.from([1, 2, 3]));

        expect(transport.ble.write).toHaveBeenCalledWith(
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
            '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
            'AQID',
            'base64',
            false
        );
    });

    test('converts Root packets to and from base64 without Node Buffer', () => {
        const originalBuffer = global.Buffer;
        try {
            global.Buffer = undefined;
            const encoded = bytesToBase64(Uint8Array.from([0, 1, 2, 127, 128, 255]));
            expect(encoded).toBe('AAECf4D/');
            expect(Array.from(base64ToBytes(encoded))).toEqual([0, 1, 2, 127, 128, 255]);
        } finally {
            global.Buffer = originalBuffer;
        }
    });

    test('encodes Root LED blink and spin states', () => {
        const protocol = new RootProtocol();
        const blink = protocol.led(2, 10, 20, 30);
        const spin = protocol.led(3, 40, 50, 60);
        expect(Array.from(blink.slice(0, 7))).toEqual([3, 2, 0, 2, 10, 20, 30]);
        expect(Array.from(spin.slice(0, 7))).toEqual([3, 2, 1, 3, 40, 50, 60]);
    });

    test.each([
        [12, 'BUMPER'],
        [17, 'TOUCH'],
        [20, 'CLIFF'],
        [14, 'BATTERY']
    ])('starts the matching event hat for device %i', (device, event) => {
        const block = new blockClass(runtime);
        runtime.startHats.mockImplementation(() => {
            expect(block.whenEvent({EVENT: event.toLowerCase()})).toBe(true);
            expect(block.whenEvent({EVENT: 'other'})).toBe(false);
        });
        block._receive(block.protocol.packet(device, 0));
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenEvent');
        expect(block.currentEvent).toBeNull();
    });

    test('does not start an event hat for a sensor query response', () => {
        const block = new blockClass(runtime);
        block._receive(block.protocol.packet(14, 1));
        expect(runtime.startHats).not.toHaveBeenCalled();
    });

    test('distinguishes individual and simultaneous bumper push/release events', () => {
        const block = new blockClass(runtime);
        const events = [];
        runtime.startHats.mockImplementation((opcode, fields) => {
            if (opcode === 'irobotRoot_whenBumper') events.push(`${fields.BUMPER}_${fields.ACTION}`);
        });
        const bumperPacket = state => block.protocol.packet(12, 0, [0, 0, 0, 0, state]);

        block._receive(bumperPacket(0x80));
        block._receive(bumperPacket(0xC0));
        block._receive(bumperPacket(0x40));
        block._receive(bumperPacket(0x00));
        block._receive(bumperPacket(0xC0));
        block._receive(bumperPacket(0x00));

        expect(events).toEqual([
            'LEFT_PUSH', 'RIGHT_PUSH', 'LEFT_RELEASE', 'RIGHT_RELEASE', 'BOTH_PUSH', 'BOTH_RELEASE'
        ]);
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenLeftBumperPush');
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenBothBumpersRelease');
        expect(block.detailedEvent()).toBe('BOTH_RELEASE');
    });

    test('fires an event for every touch sensor bit that changes', () => {
        const block = new blockClass(runtime);
        const events = [];
        runtime.startHats.mockImplementation((opcode, fields) => {
            if (opcode === 'irobotRoot_whenTouchSensor') events.push(`${fields.SENSOR}_${fields.ACTION}`);
        });
        const touchPacket = mask => block.protocol.packet(17, 0, [0, 0, 0, 0, mask << 4]);

        block._receive(touchPacket(0xF));
        block._receive(touchPacket(0x0));

        expect(events).toEqual([
            'FL_TOUCH', 'FR_TOUCH', 'RR_TOUCH', 'RL_TOUCH',
            'FL_RELEASE', 'FR_RELEASE', 'RR_RELEASE', 'RL_RELEASE'
        ]);
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenFLTouch');
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenRLRelease');
        expect(block.detailedEvent()).toBe('RL_RELEASE');
    });

    test('still starts a fixed hat when a saved parameterized hat is malformed', () => {
        const block = new blockClass(runtime);
        runtime.startHats.mockImplementation(opcode => {
            if (opcode === 'irobotRoot_whenTouchSensor') throw new Error('missing SENSOR field');
        });

        block._receive(block.protocol.packet(17, 0, [0, 0, 0, 0, 0x80]));

        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenFLTouch');
        expect(block.detailedEvent()).toBe('FL_TOUCH');
        expect(block.lastConnectionError()).toBe('missing SENSOR field');
    });
});
