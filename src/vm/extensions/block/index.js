import BlockType from '../../extension-support/block-type';
import ArgumentType from '../../extension-support/argument-type';
import Cast from '../../util/cast';
import translations from './translations.json';
import blockIcon from './block-icon.png';
import {RootProtocol, RootTransport} from './root-ble';

let formatMessage = message => message.default;
const setupTranslations = () => {
    if (!formatMessage || typeof formatMessage.setup !== 'function') return;
    const localeSetup = formatMessage.setup();
    if (!localeSetup || !localeSetup.translations) return;
    const locale = localeSetup.locale || 'en';
    const localizedMessages = translations[locale] || translations[locale.split('-')[0]];
    if (!localizedMessages) return;
    if (!localeSetup.translations[locale]) localeSetup.translations[locale] = {};
    Object.assign(localeSetup.translations[locale], localizedMessages);
};

const translate = (id, defaultText, description) => formatMessage({
    id: `irobotRoot.${id}`,
    default: defaultText,
    description: description || id
});

const EXTENSION_ID = 'irobotRoot';
const COMMAND_FINISH_TIMEOUT_MS = 120000;
const MOTION_WATCHDOG_BASE_MS = 2000;
const MOTION_WATCHDOG_MIN_SPEED_MM_S = 20;
const MOTION_WATCHDOG_SETTLE_MS = 300;
const ROOT_HALF_TRACK_MM = 43;
let extensionURL = 'https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs';

const clampMotionWatchdog = duration => Math.min(
    COMMAND_FINISH_TIMEOUT_MS - 1000,
    Math.max(MOTION_WATCHDOG_BASE_MS, Math.ceil(duration))
);

const linearMotionWatchdogMs = distanceMm => clampMotionWatchdog(
    MOTION_WATCHDOG_BASE_MS + ((Math.abs(distanceMm) / MOTION_WATCHDOG_MIN_SPEED_MM_S) * 1000)
);

const turnMotionWatchdogMs = degrees => linearMotionWatchdogMs(
    Math.abs(degrees) * Math.PI / 180 * ROOT_HALF_TRACK_MM
);

const arcMotionWatchdogMs = (degrees, radiusMm) => linearMotionWatchdogMs(
    Math.abs(degrees) * Math.PI / 180 * (Math.abs(radiusMm) + ROOT_HALF_TRACK_MM)
);

const FIXED_EVENT_HAT_MESSAGES = [
    ['whenLeftBumperPush', 'hat.leftBumperPush', 'when left bumper is pushed'],
    ['whenLeftBumperRelease', 'hat.leftBumperRelease', 'when left bumper is released'],
    ['whenRightBumperPush', 'hat.rightBumperPush', 'when right bumper is pushed'],
    ['whenRightBumperRelease', 'hat.rightBumperRelease', 'when right bumper is released'],
    ['whenBothBumpersPush', 'hat.bothBumpersPush', 'when both bumpers are pushed simultaneously'],
    ['whenBothBumpersRelease', 'hat.bothBumpersRelease', 'when both bumpers are released simultaneously'],
    ['whenFLTouch', 'hat.flTouch', 'when FL touch sensor is touched'],
    ['whenFLRelease', 'hat.flRelease', 'when FL touch sensor is released'],
    ['whenFRTouch', 'hat.frTouch', 'when FR touch sensor is touched'],
    ['whenFRRelease', 'hat.frRelease', 'when FR touch sensor is released'],
    ['whenRLTouch', 'hat.rlTouch', 'when RL touch sensor is touched'],
    ['whenRLRelease', 'hat.rlRelease', 'when RL touch sensor is released'],
    ['whenRRTouch', 'hat.rrTouch', 'when RR touch sensor is touched'],
    ['whenRRRelease', 'hat.rrRelease', 'when RR touch sensor is released']
];

const fixedEventHats = () => FIXED_EVENT_HAT_MESSAGES.map(([opcode, id, defaultText]) => ({
    opcode,
    func: 'whenFixedEvent',
    blockType: BlockType.HAT,
    text: translate(id, defaultText),
    isEdgeActivated: false
}));

const FIXED_EVENT_OPCODES = {
    LEFT_PUSH: 'whenLeftBumperPush',
    LEFT_RELEASE: 'whenLeftBumperRelease',
    RIGHT_PUSH: 'whenRightBumperPush',
    RIGHT_RELEASE: 'whenRightBumperRelease',
    BOTH_PUSH: 'whenBothBumpersPush',
    BOTH_RELEASE: 'whenBothBumpersRelease',
    FL_TOUCH: 'whenFLTouch',
    FL_RELEASE: 'whenFLRelease',
    FR_TOUCH: 'whenFRTouch',
    FR_RELEASE: 'whenFRRelease',
    RL_TOUCH: 'whenRLTouch',
    RL_RELEASE: 'whenRLRelease',
    RR_TOUCH: 'whenRRTouch',
    RR_RELEASE: 'whenRRRelease'
};

class IrobotRootBlocks {
    static set formatMessage (formatter) {
        formatMessage = formatter;
        if (formatMessage) setupTranslations();
    }

    static get EXTENSION_NAME () {
        return formatMessage({id: 'irobotRoot.name', default: 'iRobot Root', description: 'extension name'});
    }

    static get EXTENSION_ID () { return EXTENSION_ID; }
    static get extensionURL () { return extensionURL; }
    static set extensionURL (url) { extensionURL = url; }

    constructor (runtime) {
        this.runtime = runtime;
        if (runtime.formatMessage) formatMessage = runtime.formatMessage;
        this.protocol = new RootProtocol();
        this.pendingCommands = new Map();
        this.transport = new RootTransport(
            runtime,
            EXTENSION_ID,
            packet => this._receive(packet),
            () => this._cancelPendingCommands(new Error('Root connection was reset'))
        );
        this.last = {};
        this.lastDetailedEvent = '';
        this.currentEvent = null;
        this.bumperState = 0;
        this.touchState = 0;
    }

    getInfo () {
        setupTranslations();
        return {
            id: IrobotRootBlocks.EXTENSION_ID,
            name: IrobotRootBlocks.EXTENSION_NAME,
            extensionURL: IrobotRootBlocks.extensionURL,
            blockIconURI: blockIcon,
            showStatusButton: true,
            blocks: [
                {opcode: 'connect', blockType: BlockType.COMMAND,
                    text: translate('block.connect', 'connect to Root')},
                {opcode: 'disconnect', blockType: BlockType.COMMAND,
                    text: translate('block.disconnect', 'disconnect Root')},
                {opcode: 'isConnected', blockType: BlockType.BOOLEAN,
                    text: translate('block.isConnected', 'Root is connected?')},
                {opcode: 'transportMode', blockType: BlockType.REPORTER,
                    text: translate('block.transportMode', 'Root connection method')},
                {opcode: 'lastConnectionError', blockType: BlockType.REPORTER,
                    text: translate('block.lastConnectionError', 'last connection error')},
                '---',
                {opcode: 'motors', blockType: BlockType.COMMAND,
                    text: translate('block.motors', 'set left motor [LEFT] right motor [RIGHT]'), arguments: {
                    LEFT: {type: ArgumentType.NUMBER, defaultValue: 30}, RIGHT: {type: ArgumentType.NUMBER, defaultValue: 30}
                }},
                {opcode: 'drive', blockType: BlockType.COMMAND,
                    text: translate('block.drive', 'move [MM] mm'),
                    arguments: {MM: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                {opcode: 'turn', blockType: BlockType.COMMAND,
                    text: translate('block.turn', 'turn [DEGREES] degrees'),
                    arguments: {DEGREES: {type: ArgumentType.NUMBER, defaultValue: 90}}},
                {opcode: 'arc', blockType: BlockType.COMMAND,
                    text: translate('block.arc', 'drive an arc of [DEGREES] degrees with radius [RADIUS] mm'), arguments: {
                    RADIUS: {type: ArgumentType.NUMBER, defaultValue: 100}, DEGREES: {type: ArgumentType.NUMBER, defaultValue: 90}
                }},
                {opcode: 'stop', blockType: BlockType.COMMAND,
                    text: translate('block.stop', 'stop Root')},
                {opcode: 'marker', blockType: BlockType.COMMAND,
                    text: translate('block.marker', 'set marker [POSITION]'), arguments: {
                    POSITION: {type: ArgumentType.STRING, menu: 'markerMenu'}
                }},
                {opcode: 'led', blockType: BlockType.COMMAND,
                    text: translate('block.led', 'set LED red [RED] green [GREEN] blue [BLUE]'), arguments: {
                    RED: {type: ArgumentType.NUMBER, defaultValue: 255}, GREEN: {type: ArgumentType.NUMBER, defaultValue: 0}, BLUE: {type: ArgumentType.NUMBER, defaultValue: 0}
                }},
                {opcode: 'ledAnimation', blockType: BlockType.COMMAND,
                    text: translate('block.ledAnimation', 'set LED [EFFECT] red [RED] green [GREEN] blue [BLUE]'), arguments: {
                    EFFECT: {type: ArgumentType.STRING, menu: 'ledEffectMenu'},
                    RED: {type: ArgumentType.NUMBER, defaultValue: 0}, GREEN: {type: ArgumentType.NUMBER, defaultValue: 128}, BLUE: {type: ArgumentType.NUMBER, defaultValue: 255}
                }},
                {opcode: 'note', blockType: BlockType.COMMAND,
                    text: translate('block.note', 'play [HZ] Hz for [MS] ms'), arguments: {
                    HZ: {type: ArgumentType.NUMBER, defaultValue: 440}, MS: {type: ArgumentType.NUMBER, defaultValue: 500}
                }},
                '---',
                {opcode: 'refreshSensor', blockType: BlockType.COMMAND,
                    text: translate('block.refreshSensor', 'read [SENSOR]'), arguments: {
                    SENSOR: {type: ArgumentType.STRING, menu: 'sensorMenu'}
                }},
                {opcode: 'sensor', blockType: BlockType.REPORTER,
                    text: translate('block.sensor', '[VALUE] value'), arguments: {
                    VALUE: {type: ArgumentType.STRING, menu: 'valueMenu'}
                }},
                {opcode: 'whenEvent', blockType: BlockType.HAT,
                    text: translate('block.whenEvent', 'when [EVENT] changes'), isEdgeActivated: false, arguments: {
                    EVENT: {type: ArgumentType.STRING, menu: 'eventMenu'}
                }},
                {opcode: 'whenBumper', blockType: BlockType.HAT,
                    text: translate('block.whenBumper', 'when [BUMPER] bumper is [ACTION]'),
                    isEdgeActivated: false, arguments: {
                    BUMPER: {type: ArgumentType.STRING, menu: 'bumperMenu'},
                    ACTION: {type: ArgumentType.STRING, menu: 'bumperActionMenu'}
                }},
                {opcode: 'whenTouchSensor', blockType: BlockType.HAT,
                    text: translate('block.whenTouchSensor', 'when [SENSOR] touch sensor is [ACTION]'),
                    isEdgeActivated: false, arguments: {
                    SENSOR: {type: ArgumentType.STRING, menu: 'touchSensorMenu'},
                    ACTION: {type: ArgumentType.STRING, menu: 'touchActionMenu'}
                }},
                ...fixedEventHats(),
                '---',
                {opcode: 'raw', blockType: BlockType.COMMAND,
                    text: translate('block.raw', 'device [DEVICE] command [COMMAND] payload [PAYLOAD]'), arguments: {
                    DEVICE: {type: ArgumentType.NUMBER, defaultValue: 1},
                    COMMAND: {type: ArgumentType.NUMBER, defaultValue: 4},
                    PAYLOAD: {type: ArgumentType.STRING, defaultValue: '00 00 00 64 00 00 00 64'}
                }},
                {opcode: 'lastPacket', blockType: BlockType.REPORTER,
                    text: translate('block.lastPacket', 'last received packet')},
                {opcode: 'detailedEvent', blockType: BlockType.REPORTER,
                    text: translate('block.detailedEvent', 'last detailed event')}
            ],
            menus: {
                markerMenu: {acceptReporters: true, items: [
                    {text: translate('menu.marker.up', 'up'), value: '0'},
                    {text: translate('menu.marker.down', 'down'), value: '1'},
                    {text: translate('menu.marker.eraser', 'eraser'), value: '2'}
                ]},
                sensorMenu: {items: [
                    {text: translate('menu.sensor.battery', 'battery'), value: 'battery'},
                    {text: translate('menu.sensor.light', 'light'), value: 'light'},
                    {text: translate('menu.sensor.accel', 'accelerometer'), value: 'accel'}
                ]},
                ledEffectMenu: {acceptReporters: true, items: [
                    {text: translate('menu.led.off', 'off'), value: '0'},
                    {text: translate('menu.led.on', 'on'), value: '1'},
                    {text: translate('menu.led.blink', 'blink'), value: '2'},
                    {text: translate('menu.led.spin', 'spin'), value: '3'}
                ]},
                valueMenu: {acceptReporters: true, items: [
                    {text: translate('menu.value.batteryPercent', 'battery level (%)'), value: 'batteryPercent'},
                    {text: translate('menu.value.batteryMv', 'battery voltage (mV)'), value: 'batteryMv'},
                    {text: translate('menu.value.lightLeft', 'left light level'), value: 'lightLeft'},
                    {text: translate('menu.value.lightRight', 'right light level'), value: 'lightRight'},
                    {text: translate('menu.value.accelX', 'acceleration X'), value: 'accelX'},
                    {text: translate('menu.value.accelY', 'acceleration Y'), value: 'accelY'},
                    {text: translate('menu.value.accelZ', 'acceleration Z'), value: 'accelZ'},
                    {text: translate('menu.value.leftBumper', 'left bumper'), value: 'leftBumper'},
                    {text: translate('menu.value.rightBumper', 'right bumper'), value: 'rightBumper'},
                    {text: translate('menu.value.touchMask', 'touch sensor mask'), value: 'touchMask'},
                    {text: translate('menu.value.cliff', 'cliff sensor'), value: 'cliff'}
                ]},
                eventMenu: {items: [
                    {text: translate('menu.event.bumper', 'bumper'), value: 'bumper'},
                    {text: translate('menu.event.touch', 'touch'), value: 'touch'},
                    {text: translate('menu.event.cliff', 'cliff sensor'), value: 'cliff'},
                    {text: translate('menu.event.battery', 'battery'), value: 'battery'}
                ]},
                bumperMenu: {items: [
                    {text: translate('menu.bumper.left', 'left'), value: 'LEFT'},
                    {text: translate('menu.bumper.right', 'right'), value: 'RIGHT'},
                    {text: translate('menu.bumper.both', 'both'), value: 'BOTH'}
                ]},
                bumperActionMenu: {items: [
                    {text: translate('menu.action.push', 'Push'), value: 'PUSH'},
                    {text: translate('menu.action.release', 'Release'), value: 'RELEASE'}
                ]},
                touchSensorMenu: {items: [
                    {text: 'FL', value: 'FL'}, {text: 'FR', value: 'FR'},
                    {text: 'RL', value: 'RL'}, {text: 'RR', value: 'RR'}
                ]},
                touchActionMenu: {items: [
                    {text: translate('menu.action.touch', 'Touch'), value: 'TOUCH'},
                    {text: translate('menu.action.release', 'Release'), value: 'RELEASE'}
                ]}
            }
        };
    }

    connect () { this.transport.scan(); }

    disconnect () { this.transport.disconnect(); }
    isConnected () { return this.transport.isConnected(); }
    transportMode () { return this.transport.mode; }
    lastConnectionError () { return this.transport.lastError; }

    motors (args) { return this._send(this.protocol.motors(Cast.toNumber(args.LEFT), Cast.toNumber(args.RIGHT))); }
    drive (args) {
        const distance = Cast.toNumber(args.MM);
        return this._sendAndWait(this.protocol.driveDistance(distance), linearMotionWatchdogMs(distance));
    }
    turn (args) {
        const degrees = Cast.toNumber(args.DEGREES);
        return this._sendAndWait(this.protocol.rotate(degrees * 10), turnMotionWatchdogMs(degrees));
    }
    arc (args) {
        const degrees = Cast.toNumber(args.DEGREES);
        const radius = Cast.toNumber(args.RADIUS);
        return this._sendAndWait(
            this.protocol.driveArc(degrees * 10, radius),
            arcMotionWatchdogMs(degrees, radius)
        );
    }
    stop () { return this._send(this.protocol.packet(0, 3)); }
    marker (args) { return this._send(this.protocol.packet(2, 0, [Cast.toNumber(args.POSITION)])); }
    led (args) { return this._send(this.protocol.led(1, Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE))); }
    ledAnimation (args) {
        return this._send(this.protocol.led(
            Cast.toNumber(args.EFFECT), Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE)
        ));
    }
    note (args) { return this._send(this.protocol.note(Cast.toNumber(args.HZ), Cast.toNumber(args.MS))); }

    refreshSensor (args) {
        const commands = {battery: [14, 1], light: [13, 1], accel: [16, 1]};
        const command = commands[args.SENSOR];
        return command ? this._send(this.protocol.packet(command[0], command[1])) : undefined;
    }

    sensor (args) { return this.last[args.VALUE] === undefined ? 0 : this.last[args.VALUE]; }

    whenEvent (args) { return String(args.EVENT).toUpperCase() === this.currentEvent; }

    // These hats are selected by runtime.startHats match fields before their
    // primitives run, so the primitive itself must allow the selected thread.
    whenBumper () { return true; }

    whenTouchSensor () { return true; }

    whenFixedEvent () { return true; }

    raw (args) {
        return this._send(this.protocol.packet(Cast.toNumber(args.DEVICE), Cast.toNumber(args.COMMAND), RootProtocol.hexToBytes(args.PAYLOAD)));
    }

    lastPacket () { return this.last.raw || ''; }
    detailedEvent () { return this.lastDetailedEvent; }
    _send (packet) {
        // Hardware writes are fire-and-forget from Scratch's point of view.
        // Scratch Link/Scrub may leave the JSON-RPC write promise pending even
        // after CoreBluetooth accepted the bytes; returning that promise would
        // leave the command block and the rest of its stack permanently waiting.
        try {
            const pendingWrite = this.transport.write(packet);
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this.transport.setError(error));
            }
        } catch (error) {
            this.transport.setError(error);
        }
    }

    _commandKey (device, command, packetId) {
        return `${device}:${command}:${packetId}`;
    }

    _sendAndWait (packet, motionWatchdogMs) {
        const key = this._commandKey(packet[0], packet[1], packet[2]);
        const completion = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = this.pendingCommands.get(key);
                if (!pending) return;
                this._clearPendingCommand(key, pending);
                const error = new Error(
                    `Root command timed out (command ${packet[1]}, packet ${packet[2]})`
                );
                this.transport.setError(error);
                reject(error);
            }, COMMAND_FINISH_TIMEOUT_MS);
            const watchdog = setTimeout(() => {
                const pending = this.pendingCommands.get(key);
                if (!pending || pending.settling) return;
                pending.settling = true;

                // A finite Root movement can keep making tiny closed-loop
                // corrections indefinitely on a slippery/uneven surface and
                // never emit its Finished response. A zero-speed motor command
                // safely interrupts that action; the protocol specifies that an
                // interrupted movement also produces its matching Finished
                // response. Resolve after a short BLE settling interval even if
                // old firmware omits that response.
                this._sendMotionStop(key);
                pending.settle = setTimeout(() => {
                    if (this.pendingCommands.get(key) !== pending) return;
                    this._clearPendingCommand(key, pending);
                    this.transport.setError(new Error(
                        `Root motion completion watchdog stopped residual movement (command ${packet[1]})`
                    ));
                    resolve();
                }, MOTION_WATCHDOG_SETTLE_MS);
            }, motionWatchdogMs);
            this.pendingCommands.set(key, {resolve, reject, timeout, watchdog, settle: null, settling: false});
        });

        // Do not await Scratch Link/Scrub's JSON-RPC write promise. Some Scrub
        // versions leave it pending after CoreBluetooth has accepted the bytes.
        // The Scratch block waits only for Root's own matching Finished packet.
        try {
            const pendingWrite = this.transport.write(packet);
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this._rejectPendingCommand(key, error));
            }
        } catch (error) {
            this._rejectPendingCommand(key, error);
        }
        return completion;
    }

    _resolvePendingCommand (decoded) {
        const key = this._commandKey(decoded.device, decoded.command, decoded.packetId);
        const pending = this.pendingCommands.get(key);
        if (!pending) return false;
        // Explicitly zero the wheel speeds even after Root reports completion.
        // This prevents a residual velocity/controller correction from leaking
        // into the following Scratch command.
        if (!pending.settling) this._sendMotionStop(key);
        this._clearPendingCommand(key, pending);
        pending.resolve();
        return true;
    }

    _sendMotionStop (pendingKey) {
        try {
            const pendingWrite = this.transport.write(this.protocol.motors(0, 0));
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this._rejectPendingCommand(pendingKey, error));
            }
        } catch (error) {
            this._rejectPendingCommand(pendingKey, error);
        }
    }

    _clearPendingCommand (key, pending) {
        clearTimeout(pending.timeout);
        clearTimeout(pending.watchdog);
        if (pending.settle) clearTimeout(pending.settle);
        this.pendingCommands.delete(key);
    }

    _rejectPendingCommand (key, error) {
        const pending = this.pendingCommands.get(key);
        if (!pending) return false;
        this._clearPendingCommand(key, pending);
        this.transport.setError(error);
        pending.reject(error);
        return true;
    }

    _cancelPendingCommands (error) {
        for (const [key, pending] of this.pendingCommands) {
            this._clearPendingCommand(key, pending);
            pending.reject(error);
        }
    }

    _startEventHat (opcode, property, event) {
        this[property] = event;
        try {
            this.runtime.startHats(`${EXTENSION_ID}_${opcode}`);
        } finally {
            this[property] = null;
        }
    }

    _startBumperHat (event) {
        this.lastDetailedEvent = event;
        this._startFixedEventHat(event);
        const [bumper, action] = event.split('_');
        try {
            this.runtime.startHats(`${EXTENSION_ID}_whenBumper`, {BUMPER: bumper, ACTION: action});
        } catch (error) {
            // A parameterized hat saved by an older extension version can have
            // stale/missing fields. It must not prevent fixed hats or BLE I/O.
            this.transport.setError(error);
        }
    }

    _startTouchHat (event) {
        this.lastDetailedEvent = event;
        this._startFixedEventHat(event);
        const [sensor, action] = event.split('_');
        try {
            this.runtime.startHats(`${EXTENSION_ID}_whenTouchSensor`, {SENSOR: sensor, ACTION: action});
        } catch (error) {
            this.transport.setError(error);
        }
    }

    _startFixedEventHat (event) {
        const opcode = FIXED_EVENT_OPCODES[event];
        if (opcode) this.runtime.startHats(`${EXTENSION_ID}_${opcode}`);
    }

    _receiveBumperEvent (decoded) {
        const previous = this.bumperState;
        const next = (decoded.leftBumper ? 0x80 : 0) | (decoded.rightBumper ? 0x40 : 0);
        this.bumperState = next;

        if (previous === 0 && next === 0xC0) {
            this._startBumperHat('BOTH_PUSH');
            return;
        }
        if (previous === 0xC0 && next === 0) {
            this._startBumperHat('BOTH_RELEASE');
            return;
        }
        if ((previous ^ next) & 0x80) {
            this._startBumperHat(next & 0x80 ? 'LEFT_PUSH' : 'LEFT_RELEASE');
        }
        if ((previous ^ next) & 0x40) {
            this._startBumperHat(next & 0x40 ? 'RIGHT_PUSH' : 'RIGHT_RELEASE');
        }
    }

    _receiveTouchEvent (decoded) {
        const previous = this.touchState;
        const next = decoded.touchMask;
        this.touchState = next;
        const sensors = [['FL', 0x8], ['FR', 0x4], ['RR', 0x2], ['RL', 0x1]];
        for (const [sensor, mask] of sensors) {
            if ((previous ^ next) & mask) {
                this._startTouchHat(`${sensor}_${next & mask ? 'TOUCH' : 'RELEASE'}`);
            }
        }
    }

    _receive (packet) {
        const decoded = this.protocol.decode(packet);
        if (!decoded) return;
        this.last = Object.assign({}, this.last, decoded);
        this._resolvePendingCommand(decoded);
        if (decoded.command !== 0) return;
        if (decoded.device === 12) this._receiveBumperEvent(decoded);
        if (decoded.device === 17) this._receiveTouchEvent(decoded);
        const names = {12: 'BUMPER', 17: 'TOUCH', 20: 'CLIFF', 14: 'BATTERY'};
        const name = names[decoded.device];
        if (name) this._startEventHat('whenEvent', 'currentEvent', name);
    }
}

export {
    arcMotionWatchdogMs,
    COMMAND_FINISH_TIMEOUT_MS,
    IrobotRootBlocks as default,
    IrobotRootBlocks as blockClass,
    linearMotionWatchdogMs,
    MOTION_WATCHDOG_SETTLE_MS,
    turnMotionWatchdogMs
};
