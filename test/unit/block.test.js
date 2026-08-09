import {
    COMMAND_FINISH_TIMEOUT_MS,
    MOTION_COMMAND_GAP_MS,
    MOTION_WATCHDOG_SETTLE_MS,
    blockClass,
    linearMotionWatchdogMs,
    navigationMotionWatchdogMs
} from '../../src/vm/extensions/block/index.js';
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
import translations from '../../src/vm/extensions/block/translations.json';

describe('iRobot Root extension', () => {
    const formatMessage = msg => msg.default;
    formatMessage.setup = () => ({locale: 'ja', translations: {ja: {}}});
    const runtime = {
        formatMessage,
        registerPeripheralExtension: jest.fn(),
        startHats: jest.fn(),
        greenFlag: jest.fn(),
        stopAll: jest.fn()
    };

    beforeEach(() => {
        runtime.registerPeripheralExtension.mockClear();
        runtime.startHats.mockClear();
        runtime.greenFlag.mockClear();
        runtime.stopAll.mockClear();
    });

    test('exposes the official Xcratch block class metadata', () => {
        const block = new blockClass(runtime);
        expect(block).toBeInstanceOf(blockClass);
        expect(block.getInfo().id).toBe('irobotRoot');
        expect(block.getInfo().blocks.some(item => item.opcode === 'connect')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'setControlMode')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'openSimulator')).toBe(true);
        expect(block.getInfo().blocks.find(item => item.opcode === 'motors').arguments.LEFT.type)
            .toBe('root-motor-left');
        expect(block.getInfo().blocks.find(item => item.opcode === 'turn').arguments.DEGREES.type)
            .toBe('root-turn-angle');
        expect(block.getInfo().blocks.find(item => item.opcode === 'arc').arguments.RADIUS.type)
            .toBe('root-arc-radius');
        expect(block.getInfo().blocks.some(item => item.opcode === 'resetNavigation')).toBe(true);
        expect(block.getInfo().blocks.find(item => item.opcode === 'navigateTo').arguments.X.type)
            .toBe('number');
        expect(block.getInfo().customFieldTypes['root-motor-left'].implementation).toMatchObject({
            type: 'root-motion-picker', mode: 'motor', side: 'left', min: -100, max: 100,
            directInput: true, keypad: true
        });
        expect(block.getInfo().customFieldTypes['root-arc-angle'].implementation).toMatchObject({
            type: 'root-motion-picker', mode: 'arc', min: -360, max: 360
        });
        expect(block.getInfo().blocks.find(item => item.opcode === 'ledColor').arguments.COLOR.type).toBe('color');
        expect(block.getInfo().blocks.find(item => item.opcode === 'ledAnimationColor').arguments.COLOR.type)
            .toBe('color');
        expect(block.getInfo().blocks.some(item => item.opcode === 'ledAnimation')).toBe(true);
        expect(block.getInfo().blocks.find(item => item.opcode === 'playNote').arguments.NOTE.type).toBe('note');
        expect(block.getInfo().blocks.some(item => item.opcode === 'sayPhrase')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenBumper')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenTouchSensor')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenFLTouch')).toBe(true);
        expect(block.getInfo().blocks.some(item => item.opcode === 'whenBothBumpersRelease')).toBe(true);
        expect(block.whenBumper()).toBe(true);
        expect(block.whenTouchSensor()).toBe(true);
        expect(block.whenFixedEvent()).toBe(true);
        expect(runtime.registerPeripheralExtension).toHaveBeenCalledWith('irobotRoot', block.transport);
    });

    test('runs motion in simulator-fixed mode without writing BLE packets', async () => {
        jest.useFakeTimers();
        try {
            const block = new blockClass(runtime);
            block.transport.write = jest.fn();
            block.setControlMode({MODE: 'simulator'});
            const completion = block.drive({MM: 120});
            expect(block.controlTarget()).toBe('Simulator');
            expect(block.transport.write).not.toHaveBeenCalled();
            jest.advanceTimersByTime(2000);
            await completion;
            expect(block.simulator.pose.y).toBeCloseTo(120, 0);
            expect(block.transport.write).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test('keeps simulator marker trails and LED animation state while moving', async () => {
        jest.useFakeTimers();
        try {
            const block = new blockClass(runtime);
            block.transport.write = jest.fn();
            block.setControlMode({MODE: 'simulator'});
            block.marker({POSITION: '1'});
            block.ledAnimation({EFFECT: '3', RED: 255, GREEN: 20, BLUE: 40});
            const completion = block.drive({MM: 120});
            jest.advanceTimersByTime(2000);
            await completion;
            expect(block.simulator.trail.length).toBeGreaterThan(0);
            expect(block.simulator.marker).toBe(1);
            expect(block.simulator.led).toEqual({effect: 3, red: 255, green: 20, blue: 40});
            expect(block.simulator._ledPhase).toBeGreaterThan(0);
            block.simulator.reset();
        } finally {
            jest.useRealTimers();
        }
    });

    test('navigation reset preserves simulator marker and LED state', () => {
        const block = new blockClass(runtime);
        block.setControlMode({MODE: 'simulator'});
        block.marker({POSITION: '1'});
        block.ledAnimation({EFFECT: '3', RED: 20, GREEN: 40, BLUE: 255});
        block.simulator.trail.push({x1: 0, y1: 0, x2: 10, y2: 0});
        block.resetNavigation();
        expect(block.simulator.pose).toEqual({x: 0, y: 0, heading: 90});
        expect(block.simulator.marker).toBe(1);
        expect(block.simulator.led).toEqual({effect: 3, red: 20, green: 40, blue: 255});
        expect(block.simulator.trail).toHaveLength(1);
        block.simulator.reset();
    });

    test('simulator obstacles stop Root and fire bumper push and release hats', async () => {
        jest.useFakeTimers();
        try {
            const block = new blockClass(runtime);
            block.setControlMode({MODE: 'simulator'});
            block.simulator.obstacles.push({type: 'wall', x: 0, y: 70, width: 120, height: 14});
            const forward = block.drive({MM: 120});
            jest.advanceTimersByTime(2000);
            await forward;
            expect(block.simulator.pose.y).toBeLessThan(70);
            expect(block.simulator.last.leftBumper).toBe(true);
            expect(block.simulator.last.rightBumper).toBe(true);
            expect(block.simulator._collisionPoint).toEqual(expect.objectContaining({x: expect.any(Number), y: expect.any(Number)}));
            expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenBothBumpersPush');

            const backward = block.drive({MM: -30});
            jest.advanceTimersByTime(1000);
            await backward;
            expect(block.simulator.last.leftBumper).toBe(false);
            expect(block.simulator.last.rightBumper).toBe(false);
            expect(block.simulator._collisionPoint).toBeNull();
            expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenBothBumpersRelease');
        } finally {
            jest.useRealTimers();
        }
    });

    test('simulator touch input fires individual touch and release hats', () => {
        const block = new blockClass(runtime);
        block.setControlMode({MODE: 'simulator'});
        block.simulator._setTouchMask(0x8);
        block.simulator._setTouchMask(0);
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenFLTouch');
        expect(runtime.startHats).toHaveBeenCalledWith('irobotRoot_whenFLRelease');
    });

    test('simulator speed control accepts classroom-friendly multipliers', () => {
        const block = new blockClass(runtime);
        expect(block.simulator.speedMultiplier).toBe(1);
        block.simulator.setSpeedMultiplier(0.25);
        expect(block.simulator.speedMultiplier).toBe(0.25);
        block.simulator.setSpeedMultiplier(4);
        expect(block.simulator.speedMultiplier).toBe(4);
        block.simulator.setSpeedMultiplier(3);
        expect(block.simulator.speedMultiplier).toBe(1);
    });

    test('simulator run again resets Root state, keeps the field, and starts the green flag', () => {
        const block = new blockClass(runtime);
        block.setControlMode({MODE: 'simulator'});
        block.simulator.setSpeedMultiplier(0.5);
        block.simulator.addObstacle('block');
        block.simulator.marker = 1;
        block.simulator.led = {effect: 1, red: 255, green: 0, blue: 0};
        block.simulator.pose = {x: 50, y: 80, heading: 20};
        block.simulator.trail.push({x1: 0, y1: 0, x2: 50, y2: 80});

        expect(block.simulator.runProject()).toBe(true);
        expect(runtime.greenFlag).toHaveBeenCalledTimes(1);
        expect(block.simulator.pose).toEqual({x: 0, y: 0, heading: 90});
        expect(block.simulator.marker).toBe(0);
        expect(block.simulator.led.effect).toBe(0);
        expect(block.simulator.trail).toHaveLength(0);
        expect(block.simulator.obstacles).toHaveLength(1);
        expect(block.simulator.speedMultiplier).toBe(0.5);

        block.setControlMode({MODE: 'physical'});
        expect(block.simulator.runProject()).toBe(false);
        expect(runtime.greenFlag).toHaveBeenCalledTimes(1);
    });

    test('simulator stop button stops Scratch only while simulator control is active', () => {
        const block = new blockClass(runtime);
        block.setControlMode({MODE: 'simulator'});
        expect(block.simulator.stopProject()).toBe(true);
        expect(runtime.stopAll).toHaveBeenCalledTimes(1);
        block.setControlMode({MODE: 'physical'});
        expect(block.simulator.stopProject()).toBe(false);
        expect(runtime.stopAll).toHaveBeenCalledTimes(1);
    });

    test('updates block and menu labels between Japanese, hiragana Japanese, and English', () => {
        const localeSetup = {locale: 'ja', translations: {ja: {}, 'ja-Hira': {}, en: {}}};
        const localizedFormatMessage = message =>
            localeSetup.translations[localeSetup.locale][message.id] || message.default;
        localizedFormatMessage.setup = () => localeSetup;
        const localizedRuntime = Object.assign({}, runtime, {formatMessage: localizedFormatMessage});
        const block = new blockClass(localizedRuntime);
        const findBlock = (info, opcode) => info.blocks.find(item => item.opcode === opcode);

        const japaneseInfo = block.getInfo();
        expect(findBlock(japaneseInfo, 'connect').text).toBe('Rootに接続する');
        expect(findBlock(japaneseInfo, 'motors').text).toBe('左モーター [LEFT] 右モーター [RIGHT]');
        expect(findBlock(japaneseInfo, 'ledColor').text).toBe('LEDを [COLOR] にする');
        expect(findBlock(japaneseInfo, 'ledAnimationColor').text).toBe('LEDを [EFFECT] で [COLOR] にする');
        expect(findBlock(japaneseInfo, 'playNote').text).toBe('音階 [NOTE] を [MS] ミリ秒鳴らす');
        expect(findBlock(japaneseInfo, 'resetNavigation').text).toBe('ナビをリセットする');
        expect(findBlock(japaneseInfo, 'navigateTo').text).toBe('ナビで x [X] y [Y] cmへ移動する');
        expect(findBlock(japaneseInfo, 'sayPhrase').text).toBe('[PHRASE] と言う');
        expect(findBlock(japaneseInfo, 'whenFLTouch').text).toBe('FLタッチセンサーに触れたとき');
        expect(japaneseInfo.menus.markerMenu.items[0]).toEqual({text: '上げる', value: '0'});
        expect(block.simulator._t('runAgain', '▶ Run again')).toBe('▶ もう一度実行');
        expect(block.simulator._t('clearObstacles', 'Clear obstacles')).toBe('障害物を全消去');

        localeSetup.locale = 'ja-Hira';
        const hiraganaInfo = block.getInfo();
        expect(findBlock(hiraganaInfo, 'connect').text).toBe('るーとにつなぐ');
        expect(findBlock(hiraganaInfo, 'motors').text).toBe('ひだりもーたー [LEFT] みぎもーたー [RIGHT]');
        expect(findBlock(hiraganaInfo, 'ledColor').text).toBe('えるいーでぃーを [COLOR] にする');
        expect(findBlock(hiraganaInfo, 'playNote').text).toBe('おんかい [NOTE] を [MS] みりびょうならす');
        expect(findBlock(hiraganaInfo, 'resetNavigation').text).toBe('なびのいちをりせっとする');
        expect(findBlock(hiraganaInfo, 'navigateTo').text).toBe('なびで x [X] y [Y] cmへうごく');
        expect(findBlock(hiraganaInfo, 'sayPhrase').text).toBe('[PHRASE] という');
        expect(findBlock(hiraganaInfo, 'whenBumper').text).toBe('[BUMPER] ばんぱーが [ACTION] とき');
        expect(findBlock(hiraganaInfo, 'whenFLTouch').text).toBe('FLたっちせんさーにふれたとき');
        expect(hiraganaInfo.menus.markerMenu.items[0]).toEqual({text: 'あげる', value: '0'});
        expect(hiraganaInfo.menus.bumperActionMenu.items[0]).toEqual({text: 'おされた', value: 'PUSH'});
        expect(block.simulator._t('runAgain', '▶ Run again')).toBe('▶ もういちどうごかす');
        expect(block.simulator._t('clearObstacles', 'Clear obstacles')).toBe('しょうがいぶつをぜんぶけす');
        expect(hiraganaInfo.customFieldTypes['root-motor-left'].implementation.labels['ja-Hira'])
            .toBe('ひだりもーたーのしゅつりょく');

        localeSetup.locale = 'en-US';
        const englishInfo = block.getInfo();
        expect(findBlock(englishInfo, 'connect').text).toBe('connect to Root');
        expect(findBlock(englishInfo, 'motors').text).toBe('set left motor [LEFT] right motor [RIGHT]');
        expect(findBlock(englishInfo, 'ledColor').text).toBe('set LED to [COLOR]');
        expect(findBlock(englishInfo, 'ledAnimationColor').text).toBe('set LED [EFFECT] to [COLOR]');
        expect(findBlock(englishInfo, 'playNote').text).toBe('play note [NOTE] for [MS] ms');
        expect(findBlock(englishInfo, 'resetNavigation').text).toBe('reset navigation position');
        expect(findBlock(englishInfo, 'navigateTo').text).toBe('navigate to x [X] y [Y] cm');
        expect(findBlock(englishInfo, 'sayPhrase').text).toBe('say [PHRASE]');
        expect(findBlock(englishInfo, 'whenFLTouch').text).toBe('when FL touch sensor is touched');
        expect(englishInfo.menus.markerMenu.items[0]).toEqual({text: 'up', value: '0'});
        expect(block.simulator._t('runAgain', '▶ Run again')).toBe('▶ Run again');
    });

    test('keeps the hiragana locale complete and free of kanji and katakana letters', () => {
        expect(Object.keys(translations['ja-Hira']).sort()).toEqual(Object.keys(translations.en).sort());
        Object.values(translations['ja-Hira']).forEach(message => {
            expect(message).not.toMatch(/[\u3400-\u9fff\u30a1-\u30fa\u30fd-\u30ff]/);
        });
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

    test('encodes the documented Sound device Play Note packet', () => {
        const packet = new RootProtocol().note(440, 500);
        const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

        expect(packet[0]).toBe(5);
        expect(packet[1]).toBe(0);
        expect(view.getUint32(3, false)).toBe(440);
        expect(view.getUint16(7, false)).toBe(500);
        expect(crc8(packet.slice(0, 19))).toBe(packet[19]);
    });

    test('encodes the documented reset and navigate-to-position packets', () => {
        const protocol = new RootProtocol();
        const reset = protocol.resetPosition();
        const navigate = protocol.navigateTo(-160, 80);
        const view = new DataView(navigate.buffer, navigate.byteOffset, navigate.byteLength);

        expect(Array.from(reset.slice(0, 3))).toEqual([1, 15, 0]);
        expect(crc8(reset.slice(0, 19))).toBe(reset[19]);
        expect(Array.from(navigate.slice(0, 3))).toEqual([1, 17, 1]);
        expect(view.getInt32(3, false)).toBe(-160);
        expect(view.getInt32(7, false)).toBe(80);
        expect(view.getInt16(11, false)).toBe(-1);
        expect(crc8(navigate.slice(0, 19))).toBe(navigate[19]);
    });

    test.each([
        ['hello', [104, 101, 108, 108, 111, 0]],
        ['こんにちは', [227, 129, 147, 227, 130, 147, 227, 129, 171, 227, 129, 161, 227, 129, 175, 0]],
        ['1234567890123456extra', [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 52, 53, 54]],
        ['123456789012345🙂', [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 52, 53, 0]]
    ])('encodes Say Phrase as valid UTF-8 within the 16-byte payload: %s', (phrase, expectedPrefix) => {
        const packet = new RootProtocol().sayPhrase(phrase);
        expect(packet[0]).toBe(5);
        expect(packet[1]).toBe(4);
        expect(Array.from(packet.slice(3, 3 + expectedPrefix.length))).toEqual(expectedPrefix);
        expect(crc8(packet.slice(0, 19))).toBe(packet[19]);
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
        ['note', {HZ: 440, MS: 250}, 440],
        ['playNote', {NOTE: 69, MS: 250}, 440],
        ['playNote', {NOTE: 60, MS: 500}, 262]
    ])('%s waits for Root Play Note Finished response and sends the expected frequency', async (
        method, args, expectedFrequency
    ) => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block[method](args);
        const packet = block.transport.write.mock.calls[0][0];
        let completed = false;
        completion.then(() => {
            completed = true;
        });

        expect(packet[0]).toBe(5);
        expect(packet[1]).toBe(0);
        const packetView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
        expect(packetView.getUint32(3, false)).toBe(expectedFrequency);
        expect(packetView.getUint16(7, false)).toBe(args.MS);
        await Promise.resolve();
        expect(completed).toBe(false);

        const finished = new RootProtocol().packet(5, 0);
        finished[2] = packet[2];
        finished[19] = crc8(finished.slice(0, 19));
        block._receive(finished);
        await expect(completion).resolves.toBeUndefined();
        expect(completed).toBe(true);
        expect(block.transport.write).toHaveBeenCalledTimes(1);
    });

    test('sound completion timeout releases the Scratch stack if a notification is lost', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        try {
            const completion = block.note({HZ: 440, MS: 250});
            jest.advanceTimersByTime(1249);
            let completed = false;
            completion.then(() => {
                completed = true;
            });
            await Promise.resolve();
            expect(completed).toBe(false);

            jest.advanceTimersByTime(1);
            await expect(completion).resolves.toBeUndefined();
            expect(block.transport.lastError).toContain('sound completion response timed out');
        } finally {
            jest.useRealTimers();
        }
    });

    test('piano picker previews the selected MIDI note on a connected Root', () => {
        const block = new blockClass(runtime);
        block.transport.isConnected = jest.fn(() => true);
        block.transport.write = jest.fn();

        block._playNoteForPicker(69, block.getInfo().name);

        const packet = block.transport.write.mock.calls[0][0];
        const packetView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
        expect(packetView.getUint32(3, false)).toBe(440);
        expect(packetView.getUint16(7, false)).toBe(250);
    });

    test('say phrase waits for Root Say Phrase Finished response with the matching packet ID', async () => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block.sayPhrase({PHRASE: 'こんにちは'});
        const packet = block.transport.write.mock.calls[0][0];
        let completed = false;
        completion.then(() => {
            completed = true;
        });

        expect(packet[0]).toBe(5);
        expect(packet[1]).toBe(4);
        await Promise.resolve();
        expect(completed).toBe(false);

        const finished = new RootProtocol().packet(5, 4);
        finished[2] = packet[2];
        finished[19] = crc8(finished.slice(0, 19));
        block._receive(finished);
        await expect(completion).resolves.toBeUndefined();
        expect(completed).toBe(true);
        expect(block.transport.write).toHaveBeenCalledTimes(1);
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
        const stopPacket = block.transport.write.mock.calls[1][0];
        expect(stopPacket[0]).toBe(1);
        expect(stopPacket[1]).toBe(4);
        expect(Array.from(stopPacket.slice(3, 11))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    test('navigation reset uses client pose and converts coordinates to turn then drive', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));

        block.resetNavigation();
        expect(block.transport.write).not.toHaveBeenCalled();
        expect(block.navigationPosition).toEqual({x: 0, y: 0, heading: 90});

        const completion = block.navigateTo({X: 16, Y: 8});
        const turnPacket = block.transport.write.mock.calls[0][0];
        const turnView = new DataView(turnPacket.buffer, turnPacket.byteOffset, turnPacket.byteLength);
        expect(Array.from(turnPacket.slice(0, 2))).toEqual([1, 12]);
        expect(turnView.getInt32(3, false)).toBe(634);
        expect(navigationMotionWatchdogMs(160, 80)).toBeGreaterThan(linearMotionWatchdogMs(160));

        const turnFinished = new RootProtocol().packet(1, 12);
        turnFinished[2] = turnPacket[2];
        turnFinished[19] = crc8(turnFinished.slice(0, 19));
        block._receive(turnFinished);
        await Promise.resolve();

        // The zero-speed packet emitted after rotation must settle before the
        // drive packet is sent, otherwise a delayed stop can cancel the drive.
        expect(block.transport.write).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(MOTION_COMMAND_GAP_MS - 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(block.transport.write).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();

        // Completing a finite movement emits a zero-speed packet before the
        // next navigation leg is sent.
        const drivePacket = block.transport.write.mock.calls[2][0];
        const driveView = new DataView(drivePacket.buffer, drivePacket.byteOffset, drivePacket.byteLength);
        expect(Array.from(drivePacket.slice(0, 2))).toEqual([1, 8]);
        expect(driveView.getInt32(3, false)).toBe(179);

        const driveFinished = new RootProtocol().packet(1, 8);
        driveFinished[2] = drivePacket[2];
        driveFinished[19] = crc8(driveFinished.slice(0, 19));
        block._receive(driveFinished);
        await expect(completion).resolves.toBeUndefined();
        expect(block.navigationPosition.x).toBe(160);
        expect(block.navigationPosition.y).toBe(80);
        expect(block.navigationPosition.heading).toBeCloseTo(26.565, 3);
        jest.useRealTimers();
    });

    test('navigation to x 5 y 5 waits between turning and driving', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));

        const completion = block.navigateTo({X: 5, Y: 5});
        const turnPacket = block.transport.write.mock.calls[0][0];
        const turnView = new DataView(turnPacket.buffer, turnPacket.byteOffset, turnPacket.byteLength);
        expect(Array.from(turnPacket.slice(0, 2))).toEqual([1, 12]);
        expect(turnView.getInt32(3, false)).toBe(450);

        const turnFinished = new RootProtocol().packet(1, 12);
        turnFinished[2] = turnPacket[2];
        turnFinished[19] = crc8(turnFinished.slice(0, 19));
        block._receive(turnFinished);
        await Promise.resolve();
        expect(block.transport.write).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(MOTION_COMMAND_GAP_MS - 1);
        await Promise.resolve();
        expect(block.transport.write).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
        const drivePacket = block.transport.write.mock.calls[2][0];
        const driveView = new DataView(drivePacket.buffer, drivePacket.byteOffset, drivePacket.byteLength);
        expect(Array.from(drivePacket.slice(0, 2))).toEqual([1, 8]);
        expect(driveView.getInt32(3, false)).toBe(71);

        const driveFinished = new RootProtocol().packet(1, 8);
        driveFinished[2] = drivePacket[2];
        driveFinished[19] = crc8(driveFinished.slice(0, 19));
        block._receive(driveFinished);
        await expect(completion).resolves.toBeUndefined();
        expect(block.navigationPosition).toEqual({x: 50, y: 50, heading: 45});
        jest.useRealTimers();
    });

    test('navigation skips the turn when the target is straight ahead', async () => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));

        const completion = block.navigateTo({X: 0, Y: 16});
        await Promise.resolve();
        await Promise.resolve();
        const drivePacket = block.transport.write.mock.calls[0][0];
        const view = new DataView(drivePacket.buffer, drivePacket.byteOffset, drivePacket.byteLength);
        expect(Array.from(drivePacket.slice(0, 2))).toEqual([1, 8]);
        expect(view.getInt32(3, false)).toBe(160);

        const finished = new RootProtocol().packet(1, 8);
        finished[2] = drivePacket[2];
        finished[19] = crc8(finished.slice(0, 19));
        block._receive(finished);
        await expect(completion).resolves.toBeUndefined();
        expect(block.navigationPosition).toEqual({x: 0, y: 160, heading: 90});
    });

    test('stops residual motion and advances when Root never reaches its finished response', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block.drive({MM: 100});
        let completed = false;
        completion.then(() => {
            completed = true;
        });

        jest.advanceTimersByTime(linearMotionWatchdogMs(100));
        const stopPacket = block.transport.write.mock.calls[1][0];
        expect(stopPacket[0]).toBe(1);
        expect(stopPacket[1]).toBe(4);
        expect(Array.from(stopPacket.slice(3, 11))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(completed).toBe(false);

        jest.advanceTimersByTime(MOTION_WATCHDOG_SETTLE_MS);
        await expect(completion).resolves.toBeUndefined();
        expect(completed).toBe(true);
        expect(block.lastConnectionError()).toContain('watchdog stopped residual movement');
        expect(block.pendingCommands.size).toBe(0);
        jest.useRealTimers();
    });

    test('reports a timeout when Root never sends a finished response', async () => {
        jest.useFakeTimers();
        const block = new blockClass(runtime);
        block.transport.write = jest.fn(() => new Promise(() => {}));
        const completion = block._sendAndWait(
            block.protocol.driveDistance(100),
            COMMAND_FINISH_TIMEOUT_MS + 1000
        );
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

    test('converts Scratch color picker values to Root RGB LED packets', () => {
        const block = new blockClass(runtime);
        block.transport.write = jest.fn();

        block.ledColor({COLOR: '#12abf0'});
        block.ledAnimationColor({EFFECT: '3', COLOR: '#285078'});

        expect(Array.from(block.transport.write.mock.calls[0][0].slice(0, 7)))
            .toEqual([3, 2, 0, 1, 18, 171, 240]);
        expect(Array.from(block.transport.write.mock.calls[1][0].slice(0, 7)))
            .toEqual([3, 2, 1, 3, 40, 80, 120]);
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
