import {blockClass} from '../../src/vm/extensions/block/index.js';
import {
    ROOT_DISCOVERY_OPTIONS,
    RootProtocol,
    RootTransport,
    base64ToBytes,
    bytesToBase64,
    crc8,
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
