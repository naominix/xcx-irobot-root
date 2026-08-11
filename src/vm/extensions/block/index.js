import BlockType from '../../extension-support/block-type';
import ArgumentType from '../../extension-support/argument-type';
import Cast from '../../util/cast';
import translations from './translations.json';
import blockIcon from './block-icon.png';
import {RootProtocol} from './root-ble';
import {RootManager} from './root-manager';
import RootSimulator from './root-simulator';

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
const SOUND_FINISH_GRACE_MS = 1000;
const SAY_PHRASE_TIMEOUT_MS = 30000;
const MOTION_WATCHDOG_BASE_MS = 2000;
const MOTION_WATCHDOG_MIN_SPEED_MM_S = 20;
const MOTION_WATCHDOG_SETTLE_MS = 300;
const MOTION_COMMAND_GAP_MS = 300;
const ROOT_HALF_TRACK_MM = 43;
const CONTROL_MODE_AUTO = 'auto';
const CONTROL_MODE_SIMULATOR = 'simulator';
const CONTROL_MODE_PHYSICAL = 'physical';
const ROOT_MOTION_PICKER_CAPABILITY = 'irobotRootMotionPickerSupported';
let extensionURL = 'https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs';

const rootMotionField = (mode, options = {}) => ({
    output: 'Number',
    outputShape: 2,
    implementation: Object.assign({
        type: 'root-motion-picker',
        mode,
        directInput: true,
        keypad: true,
        fromJson: () => null
    }, options)
});

const ROOT_MOTION_FIELD_TYPES = {
    'root-motor-left': rootMotionField('motor', {
        side: 'left', min: -100, max: 100, step: 1, unit: '%',
        labels: {en: 'Left motor power', ja: '左モーターの出力', 'ja-Hira': 'ひだりもーたーのしゅつりょく'}
    }),
    'root-motor-right': rootMotionField('motor', {
        side: 'right', min: -100, max: 100, step: 1, unit: '%',
        labels: {en: 'Right motor power', ja: '右モーターの出力', 'ja-Hira': 'みぎもーたーのしゅつりょく'}
    }),
    'root-distance': rootMotionField('distance', {
        min: -500, max: 500, step: 10, unit: 'mm',
        labels: {en: 'Travel distance', ja: '移動する距離', 'ja-Hira': 'すすむきょり'}
    }),
    'root-turn-angle': rootMotionField('turn', {
        min: -180, max: 180, step: 5, unit: '°',
        labels: {en: 'Turn angle', ja: '回転する角度', 'ja-Hira': 'まわるかくど'}
    }),
    'root-arc-radius': rootMotionField('radius', {
        min: -500, max: 500, step: 10, unit: 'mm',
        labels: {en: 'Arc radius', ja: '円弧の半径', 'ja-Hira': 'えんこのはんけい'}
    }),
    'root-arc-angle': rootMotionField('arc', {
        min: -360, max: 360, step: 5, unit: '°',
        labels: {en: 'Arc angle', ja: '円弧の角度', 'ja-Hira': 'えんこのかくど'}
    })
};

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

const navigationMotionWatchdogMs = (deltaXmm, deltaYmm) => linearMotionWatchdogMs(
    Math.hypot(deltaXmm, deltaYmm) + (Math.PI * ROOT_HALF_TRACK_MM)
);

const normalizeHeading = degrees => ((degrees % 360) + 360) % 360;
const normalizeTurn = degrees => {
    const normalized = normalizeHeading(degrees + 180) - 180;
    return normalized === -180 ? 180 : normalized;
};

const midiNoteToFrequency = midiNote => Math.round(440 * Math.pow(2, (midiNote - 69) / 12));

const FIXED_EVENT_HAT_MESSAGES = [
    ['whenLeftBumperPush', 'hat.leftBumperPush', 'when [ROOT] left bumper is pushed'],
    ['whenLeftBumperRelease', 'hat.leftBumperRelease', 'when [ROOT] left bumper is released'],
    ['whenRightBumperPush', 'hat.rightBumperPush', 'when [ROOT] right bumper is pushed'],
    ['whenRightBumperRelease', 'hat.rightBumperRelease', 'when [ROOT] right bumper is released'],
    ['whenBothBumpersPush', 'hat.bothBumpersPush', 'when [ROOT] both bumpers are pushed simultaneously'],
    ['whenBothBumpersRelease', 'hat.bothBumpersRelease', 'when [ROOT] both bumpers are released simultaneously'],
    ['whenFLTouch', 'hat.flTouch', 'when [ROOT] FL touch sensor is touched'],
    ['whenFLRelease', 'hat.flRelease', 'when [ROOT] FL touch sensor is released'],
    ['whenFRTouch', 'hat.frTouch', 'when [ROOT] FR touch sensor is touched'],
    ['whenFRRelease', 'hat.frRelease', 'when [ROOT] FR touch sensor is released'],
    ['whenRLTouch', 'hat.rlTouch', 'when [ROOT] RL touch sensor is touched'],
    ['whenRLRelease', 'hat.rlRelease', 'when [ROOT] RL touch sensor is released'],
    ['whenRRTouch', 'hat.rrTouch', 'when [ROOT] RR touch sensor is touched'],
    ['whenRRRelease', 'hat.rrRelease', 'when [ROOT] RR touch sensor is released']
];

const fixedEventHats = () => FIXED_EVENT_HAT_MESSAGES.map(([opcode, id, defaultText]) => ({
    opcode,
    func: 'whenFixedEvent',
    blockType: BlockType.HAT,
    text: translate(id, defaultText),
    isEdgeActivated: false,
    arguments: {
        ROOT: {type: ArgumentType.STRING, menu: 'rootMenu'}
    }
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
        // A custom Scratch field needs a renderer supplied by the editor GUI.
        // Official Xcratch and Scrub do not currently expose the Root motion
        // renderer, so use ordinary Scratch number inputs unless the host
        // explicitly advertises that capability. This keeps every motion block
        // editable while preserving the visual picker in enhanced editors.
        this.supportsRootMotionPicker = Boolean(runtime && runtime[ROOT_MOTION_PICKER_CAPABILITY]);
        if (runtime.formatMessage) formatMessage = runtime.formatMessage;
        this.rootManager = new RootManager(runtime, EXTENSION_ID, {
            onData: (session, packet) => this._receive(packet, session),
            onReset: session => this._cancelPendingCommands(new Error('Root connection was reset'), session)
        });
        this._hatDispatchSessionId = null;
        // Preserve the established extension behaviour for existing projects.
        // New projects can opt into Auto (simulator while disconnected) or
        // Simulator fixed explicitly; this default will be reconsidered only
        // after the simulator has completed classroom validation.
        this.controlMode = CONTROL_MODE_PHYSICAL;
        this.simulator = new RootSimulator(event => this._receiveSimulatorEvent(event), {
            isActive: () => this._isSimulatorActive(),
            translate: (id, defaultText) => {
                setupTranslations();
                return translate(`simulator.${id}`, defaultText);
            },
            onRun: () => {
                this.bumperState = 0;
                this.touchState = 0;
                if (typeof this.runtime.greenFlag === 'function') this.runtime.greenFlag();
            },
            onStop: () => {
                if (typeof this.runtime.stopAll === 'function') this.runtime.stopAll();
            }
        });
        this._playNoteForPicker = this._playNoteForPicker.bind(this);
        if (typeof this.runtime.on === 'function') this.runtime.on('PLAY_NOTE', this._playNoteForPicker);
    }

    _activeSession (util = null) {
        const sessionId = util && util.thread && util.thread.irobotRootSessionId !== undefined ?
            util.thread.irobotRootSessionId : this._hatDispatchSessionId;
        return this.rootManager.getSession(sessionId) || this.rootManager.getActiveSession();
    }

    _setThreadSession (util, session) {
        if (util && util.thread) util.thread.irobotRootSessionId = session.id;
        return session;
    }

    _matchesThreadSession (args, util) {
        const requested = args && args.ROOT;
        if (requested === undefined || requested === null || requested === '') return true;
        const sessionId = util && util.thread && util.thread.irobotRootEventSessionId !== undefined ?
            util.thread.irobotRootEventSessionId : this._hatDispatchSessionId;
        if (sessionId === undefined || sessionId === null) return true;
        return Number(requested) === Number(sessionId);
    }
    get protocol () { return this._activeSession().protocol; }
    get pendingCommands () { return this._activeSession().pendingCommands; }
    get transport () { return this._activeSession().transport; }
    get last () { return this._activeSession().last; }
    set last (value) { this._activeSession().last = value; }
    get lastDetailedEvent () { return this._activeSession().lastDetailedEvent; }
    set lastDetailedEvent (value) { this._activeSession().lastDetailedEvent = value; }
    get currentEvent () { return this._activeSession().currentEvent; }
    set currentEvent (value) { this._activeSession().currentEvent = value; }
    get bumperState () { return this._activeSession().bumperState; }
    set bumperState (value) { this._activeSession().bumperState = value; }
    get touchState () { return this._activeSession().touchState; }
    set touchState (value) { this._activeSession().touchState = value; }
    get navigationPosition () { return this._activeSession().navigationPosition; }
    set navigationPosition (value) { this._activeSession().navigationPosition = value; }

    getInfo () {
        setupTranslations();
        const motionArgumentType = customType => (
            this.supportsRootMotionPicker ? customType : ArgumentType.NUMBER
        );
        return {
            id: IrobotRootBlocks.EXTENSION_ID,
            name: IrobotRootBlocks.EXTENSION_NAME,
            extensionURL: IrobotRootBlocks.extensionURL,
            blockIconURI: blockIcon,
            showStatusButton: true,
            blocks: [
                {opcode: 'connect', blockType: BlockType.COMMAND,
                    text: translate('block.connect', 'connect to Root')},
                {opcode: 'addRoot', blockType: BlockType.COMMAND,
                    text: translate('block.addRoot', 'connect another Root')},
                {opcode: 'disconnect', blockType: BlockType.COMMAND,
                    text: translate('block.disconnect', 'disconnect Root')},
                {opcode: 'resetRootConnections', blockType: BlockType.COMMAND,
                    text: translate('block.resetRootConnections', 'disconnect all Roots and reset connections')},
                {opcode: 'selectRoot', blockType: BlockType.COMMAND,
                    text: translate('block.selectRoot', 'use [ROOT]'), arguments: {
                        ROOT: {type: ArgumentType.STRING, menu: 'rootMenu'}
                    }},
                {opcode: 'activeRoot', blockType: BlockType.REPORTER,
                    text: translate('block.activeRoot', 'selected Root')},
                {opcode: 'isConnected', blockType: BlockType.BOOLEAN,
                    text: translate('block.isConnected', 'Root is connected?')},
                {opcode: 'transportMode', blockType: BlockType.REPORTER,
                    text: translate('block.transportMode', 'Root connection method')},
                {opcode: 'lastConnectionError', blockType: BlockType.REPORTER,
                    text: translate('block.lastConnectionError', 'last connection error')},
                {opcode: 'setControlMode', blockType: BlockType.COMMAND,
                    text: translate('block.setControlMode', 'set control mode to [MODE]'), arguments: {
                    MODE: {type: ArgumentType.STRING, menu: 'controlModeMenu'}
                }},
                {opcode: 'controlTarget', blockType: BlockType.REPORTER,
                    text: translate('block.controlTarget', 'current control target')},
                {opcode: 'openSimulator', blockType: BlockType.COMMAND,
                    text: translate('block.openSimulator', 'open Root simulator')},
                {opcode: 'resetSimulator', blockType: BlockType.COMMAND,
                    text: translate('block.resetSimulator', 'reset Root simulator')},
                '---',
                {opcode: 'motors', blockType: BlockType.COMMAND,
                    text: translate('block.motors', 'set left motor [LEFT] right motor [RIGHT]'), arguments: {
                    LEFT: {type: motionArgumentType('root-motor-left'), defaultValue: 30},
                    RIGHT: {type: motionArgumentType('root-motor-right'), defaultValue: 30}
                }},
                {opcode: 'drive', blockType: BlockType.COMMAND,
                    text: translate('block.drive', 'move [MM] mm'),
                    arguments: {MM: {type: motionArgumentType('root-distance'), defaultValue: 100}}},
                {opcode: 'turn', blockType: BlockType.COMMAND,
                    text: translate('block.turn', 'turn [DEGREES] degrees'),
                    arguments: {DEGREES: {type: motionArgumentType('root-turn-angle'), defaultValue: 90}}},
                {opcode: 'arc', blockType: BlockType.COMMAND,
                    text: translate('block.arc', 'drive an arc of [DEGREES] degrees with radius [RADIUS] mm'), arguments: {
                    RADIUS: {type: motionArgumentType('root-arc-radius'), defaultValue: 100},
                    DEGREES: {type: motionArgumentType('root-arc-angle'), defaultValue: 90}
                }},
                {opcode: 'resetNavigation', blockType: BlockType.COMMAND,
                    text: translate('block.resetNavigation', 'reset navigation position')},
                {opcode: 'navigateTo', blockType: BlockType.COMMAND,
                    text: translate('block.navigateTo', 'navigate to x [X] y [Y] cm'), arguments: {
                    X: {type: ArgumentType.NUMBER, defaultValue: 16},
                    Y: {type: ArgumentType.NUMBER, defaultValue: 16}
                }},
                {opcode: 'stop', blockType: BlockType.COMMAND,
                    text: translate('block.stop', 'stop Root')},
                {opcode: 'marker', blockType: BlockType.COMMAND,
                    text: translate('block.marker', 'set marker [POSITION]'), arguments: {
                    POSITION: {type: ArgumentType.STRING, menu: 'markerMenu'}
                }},
                {opcode: 'ledColor', blockType: BlockType.COMMAND,
                    text: translate('block.ledColor', 'set LED to [COLOR]'), arguments: {
                    COLOR: {type: ArgumentType.COLOR, defaultValue: '#ff0000'}
                }},
                {opcode: 'ledAnimationColor', blockType: BlockType.COMMAND,
                    text: translate('block.ledAnimationColor', 'set LED [EFFECT] to [COLOR]'), arguments: {
                    EFFECT: {type: ArgumentType.STRING, menu: 'ledEffectMenu'},
                    COLOR: {type: ArgumentType.COLOR, defaultValue: '#0080ff'}
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
                {opcode: 'playNote', blockType: BlockType.COMMAND,
                    text: translate('block.playNote', 'play note [NOTE] for [MS] ms'), arguments: {
                    NOTE: {type: ArgumentType.NOTE, defaultValue: 60},
                    MS: {type: ArgumentType.NUMBER, defaultValue: 500}
                }},
                {opcode: 'note', blockType: BlockType.COMMAND,
                    text: translate('block.note', 'play frequency [HZ] Hz for [MS] ms'), arguments: {
                    HZ: {type: ArgumentType.NUMBER, defaultValue: 440}, MS: {type: ArgumentType.NUMBER, defaultValue: 500}
                }},
                {opcode: 'sayPhrase', blockType: BlockType.COMMAND,
                    text: translate('block.sayPhrase', 'say [PHRASE]'), arguments: {
                    PHRASE: {type: ArgumentType.STRING, defaultValue: 'hello'}
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
                    text: translate('block.whenEvent', 'when [ROOT] [EVENT] changes'), isEdgeActivated: false, arguments: {
                    ROOT: {type: ArgumentType.STRING, menu: 'rootMenu'},
                        EVENT: {type: ArgumentType.STRING, menu: 'eventMenu'}
                }},
                {opcode: 'whenBumper', blockType: BlockType.HAT,
                    text: translate('block.whenBumper', 'when [ROOT] [BUMPER] bumper is [ACTION]'),
                    isEdgeActivated: false, arguments: {
                    ROOT: {type: ArgumentType.STRING, menu: 'rootMenu'},
                    BUMPER: {type: ArgumentType.STRING, menu: 'bumperMenu'},
                    ACTION: {type: ArgumentType.STRING, menu: 'bumperActionMenu'}
                }},
                {opcode: 'whenTouchSensor', blockType: BlockType.HAT,
                    text: translate('block.whenTouchSensor', 'when [ROOT] [SENSOR] touch sensor is [ACTION]'),
                    isEdgeActivated: false, arguments: {
                    ROOT: {type: ArgumentType.STRING, menu: 'rootMenu'},
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
            customFieldTypes: this.supportsRootMotionPicker ? ROOT_MOTION_FIELD_TYPES : {},
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
                ]},
                controlModeMenu: {acceptReporters: true, items: [
                    {text: translate('menu.controlMode.auto', 'automatic'), value: CONTROL_MODE_AUTO},
                    {text: translate('menu.controlMode.simulator', 'simulator'), value: CONTROL_MODE_SIMULATOR},
                    {text: translate('menu.controlMode.physical', 'physical Root'), value: CONTROL_MODE_PHYSICAL}
                ]},
                rootMenu: {acceptReporters: true, items: 'getRootMenu'}
            }
        };
    }

    connect () {
        if (this.controlMode === CONTROL_MODE_SIMULATOR) {
            this.simulator.open();
            return;
        }
        this.rootManager.scan();
    }

    addRoot () { this.rootManager.scan(); }
    disconnect (args, util) { this.rootManager.disconnect(this._activeSession(util).id); }
    resetRootConnections () { this.rootManager.resetConnections(); }
    selectRoot (args, util) {
        this._setThreadSession(util, this.rootManager.setActiveSession(args.ROOT));
    }
    activeRoot (args, util) { return this._activeSession(util).displayName; }
    getRootMenu () { return this.rootManager.getMenu(); }
    isConnected (args, util) { return this.rootManager.isConnected(this._activeSession(util).id); }
    transportMode (args, util) { return this.rootManager.transportMode(this._activeSession(util).id); }
    lastConnectionError (args, util) {
        return this.rootManager.lastConnectionError(this._activeSession(util).id);
    }
    setControlMode (args) {
        const requested = String(args.MODE || CONTROL_MODE_AUTO);
        const mode = [CONTROL_MODE_AUTO, CONTROL_MODE_SIMULATOR, CONTROL_MODE_PHYSICAL].includes(requested) ?
            requested : CONTROL_MODE_AUTO;
        const wasPhysical = !this._isSimulatorActive();
        this.controlMode = mode;
        if (this._isSimulatorActive()) {
            if (wasPhysical && this.transport.isConnected()) this._send(this.protocol.motors(0, 0));
            this._cancelPendingCommands(new Error('Root control target changed to simulator'), this._activeSession());
            this.simulator.reset();
            this.simulator.open();
        }
        this.simulator.refresh();
    }
    controlTarget (args, util) {
        return this._isSimulatorActive(util) ? 'Simulator' : 'Physical Root';
    }
    openSimulator () { this.simulator.open(); }
    resetSimulator () { this.simulator.reset(); this.simulator.open(); }

    _isSimulatorActive (util = null, session = this._activeSession(util)) {
        return this.controlMode === CONTROL_MODE_SIMULATOR ||
            (this.controlMode === CONTROL_MODE_AUTO && !session.isConnected());
    }

    motors (args, util) {
        const session = this._activeSession(util);
        session.navigationPosition = null;
        if (this._isSimulatorActive(util, session)) {
            return this.simulator.motors(Cast.toNumber(args.LEFT), Cast.toNumber(args.RIGHT));
        }
        return this._send(session.protocol.motors(Cast.toNumber(args.LEFT), Cast.toNumber(args.RIGHT)), session);
    }
    drive (args, util) {
        const distance = Cast.toNumber(args.MM);
        const session = this._activeSession(util);
        session.navigationPosition = null;
        if (this._isSimulatorActive(util, session)) return this.simulator.move(distance);
        return this._sendAndWait(session.protocol.driveDistance(distance), linearMotionWatchdogMs(distance), session);
    }
    turn (args, util) {
        const degrees = Cast.toNumber(args.DEGREES);
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.turn(degrees);
        return this._sendAndWait(session.protocol.rotate(degrees * 10), turnMotionWatchdogMs(degrees), session);
    }
    arc (args, util) {
        const degrees = Cast.toNumber(args.DEGREES);
        const radius = Cast.toNumber(args.RADIUS);
        const session = this._activeSession(util);
        session.navigationPosition = null;
        if (this._isSimulatorActive(util, session)) return this.simulator.arc(radius, degrees);
        return this._sendAndWait(
            session.protocol.driveArc(degrees * 10, radius),
            arcMotionWatchdogMs(degrees, radius), session
        );
    }
    resetNavigation (args, util) {
        // The official SDK keeps Root rt0/rt1 pose on the client. Native
        // Reset Position / Navigate to Position packets are not accepted by
        // every Root firmware even though they exist in the shared protocol.
        const session = this._activeSession(util);
        session.navigationPosition = {x: 0, y: 0, heading: 90};
        if (this._isSimulatorActive(util, session)) this.simulator.resetNavigation();
    }
    navigateTo (args, util) {
        const target = {
            x: Math.round(Cast.toNumber(args.X) * 10),
            y: Math.round(Cast.toNumber(args.Y) * 10)
        };
        const session = this._activeSession(util);
        const origin = session.navigationPosition || {x: 0, y: 0, heading: 90};
        if (this._isSimulatorActive(util, session)) return this.simulator.navigateTo(target.x, target.y);
        const deltaX = target.x - origin.x;
        const deltaY = target.y - origin.y;
        const distance = Math.round(Math.hypot(deltaX, deltaY));
        if (distance === 0) return;

        const targetHeading = normalizeHeading(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
        // Root's finite rotate command is positive clockwise, while standard
        // xy headings increase counter-clockwise.
        const turn = normalizeTurn(origin.heading - targetHeading);
        const needsRotation = Math.abs(turn) >= 0.05;
        const rotation = needsRotation ?
            this._sendAndWait(session.protocol.rotate(Math.round(turn * 10)), turnMotionWatchdogMs(turn), session) :
            Promise.resolve();
        // A completed finite movement is followed by a zero-speed motor packet
        // to suppress residual closed-loop corrections. Scratch Link/Scrub does
        // not provide a dependable write-completion promise, so sending the next
        // leg immediately can let that stop packet arrive after the drive packet
        // and cancel it. Give BLE/CoreBluetooth one settling interval between
        // the rotate and drive legs.
        const settledRotation = needsRotation ?
            rotation.then(() => new Promise(resolve => setTimeout(resolve, MOTION_COMMAND_GAP_MS))) :
            rotation;
        return settledRotation.then(() => this._sendAndWait(
            session.protocol.driveDistance(distance), linearMotionWatchdogMs(distance), session
        )).then(() => {
            session.navigationPosition = {x: target.x, y: target.y, heading: targetHeading};
        }).catch(error => {
            session.navigationPosition = null;
            throw error;
        });
    }
    stop (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.stop();
        return this._send(session.protocol.packet(0, 3), session);
    }
    marker (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.setMarker(args.POSITION);
        return this._send(session.protocol.packet(2, 0, [Cast.toNumber(args.POSITION)]), session);
    }
    ledColor (args, util) {
        const [red, green, blue] = Cast.toRgbColorList(args.COLOR);
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.setLed(1, red, green, blue);
        return this._send(session.protocol.led(1, red, green, blue), session);
    }
    ledAnimationColor (args, util) {
        const [red, green, blue] = Cast.toRgbColorList(args.COLOR);
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.setLed(Cast.toNumber(args.EFFECT), red, green, blue);
        return this._send(session.protocol.led(Cast.toNumber(args.EFFECT), red, green, blue), session);
    }
    led (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) {
            return this.simulator.setLed(1, Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE));
        }
        return this._send(session.protocol.led(1, Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE)), session);
    }
    ledAnimation (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.setLed(
            Cast.toNumber(args.EFFECT), Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE)
        );
        return this._send(session.protocol.led(
            Cast.toNumber(args.EFFECT), Cast.toNumber(args.RED), Cast.toNumber(args.GREEN), Cast.toNumber(args.BLUE)
        ), session);
    }
    playNote (args, util) {
        const midiNote = Math.min(127, Math.max(0, Math.round(Cast.toNumber(args.NOTE))));
        return this._playFrequency(midiNoteToFrequency(midiNote), args.MS, util);
    }

    note (args, util) { return this._playFrequency(Cast.toNumber(args.HZ), args.MS, util); }

    _playFrequency (frequency, milliseconds, util) {
        // Root's sound command stores the duration in an unsigned 16-bit
        // field. Wait for Root's matching Play Note Finished packet rather
        // than a browser timer, so BLE latency cannot make the next note
        // interrupt this one just before it actually finishes.
        const durationMs = Math.min(0xFFFF, Math.max(0, Math.round(Cast.toNumber(milliseconds))));
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.playNote(frequency, durationMs);
        const packet = session.protocol.note(frequency, durationMs);
        if (durationMs === 0) {
            this._send(packet, session);
            return Promise.resolve();
        }
        return this._sendSoundAndWait(packet, durationMs, session);
    }

    _playNoteForPicker (midiNote, category) {
        if (category !== this.getInfo().name) return;
        if (this._isSimulatorActive()) {
            this.simulator.playNote(midiNoteToFrequency(Cast.toNumber(midiNote)), 250);
            return;
        }
        if (!this.transport.isConnected()) return;
        this._send(this.protocol.note(midiNoteToFrequency(Cast.toNumber(midiNote)), 250));
    }

    sayPhrase (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.sayPhrase(Cast.toString(args.PHRASE));
        return this._sendSoundCommandAndWait(
            session.protocol.sayPhrase(Cast.toString(args.PHRASE)),
            SAY_PHRASE_TIMEOUT_MS,
            'phrase', session
        );
    }

    refreshSensor (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return;
        const commands = {battery: [14, 1], light: [13, 1], accel: [16, 1]};
        const command = commands[args.SENSOR];
        return command ? this._send(session.protocol.packet(command[0], command[1]), session) : undefined;
    }

    sensor (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) return this.simulator.getSensor(args.VALUE);
        return session.last[args.VALUE] === undefined ? 0 : session.last[args.VALUE];
    }

    whenEvent (args, util) {
        return this._matchesThreadSession(args, util) &&
            String(args.EVENT).toUpperCase() === this._activeSession(util).currentEvent;
    }

    // These hats are selected by runtime.startHats match fields before their
    // primitives run, so the primitive itself must allow the selected thread.
    whenBumper (args, util) { return this._matchesThreadSession(args, util); }

    whenTouchSensor (args, util) { return this._matchesThreadSession(args, util); }

    whenFixedEvent (args, util) { return this._matchesThreadSession(args, util); }

    raw (args, util) {
        const session = this._activeSession(util);
        if (this._isSimulatorActive(util, session)) {
            session.transport.setError(new Error('Raw BLE packets are unavailable in simulator mode'));
            return;
        }
        return this._send(session.protocol.packet(Cast.toNumber(args.DEVICE), Cast.toNumber(args.COMMAND), RootProtocol.hexToBytes(args.PAYLOAD)), session);
    }

    lastPacket (args, util) { return this._activeSession(util).last.raw || ''; }
    detailedEvent (args, util) { return this._activeSession(util).lastDetailedEvent; }
    _send (packet, session = this._activeSession()) {
        // Hardware writes are fire-and-forget from Scratch's point of view.
        // Scratch Link/Scrub may leave the JSON-RPC write promise pending even
        // after CoreBluetooth accepted the bytes; returning that promise would
        // leave the command block and the rest of its stack permanently waiting.
        try {
            const pendingWrite = session.transport.write(packet);
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => session.transport.setError(error));
            }
        } catch (error) {
            session.transport.setError(error);
        }
    }

    _commandKey (device, command, packetId) {
        return `${device}:${command}:${packetId}`;
    }

    _sendAndWait (packet, motionWatchdogMs, session = this._activeSession()) {
        const key = this._commandKey(packet[0], packet[1], packet[2]);
        const completion = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = session.pendingCommands.get(key);
                if (!pending) return;
                this._clearPendingCommand(key, pending, session);
                const error = new Error(
                    `Root command timed out (command ${packet[1]}, packet ${packet[2]})`
                );
                session.transport.setError(error);
                reject(error);
            }, COMMAND_FINISH_TIMEOUT_MS);
            const watchdog = setTimeout(() => {
                const pending = session.pendingCommands.get(key);
                if (!pending || pending.settling) return;
                pending.settling = true;

                // A finite Root movement can keep making tiny closed-loop
                // corrections indefinitely on a slippery/uneven surface and
                // never emit its Finished response. A zero-speed motor command
                // safely interrupts that action; the protocol specifies that an
                // interrupted movement also produces its matching Finished
                // response. Resolve after a short BLE settling interval even if
                // old firmware omits that response.
                this._sendMotionStop(key, session);
                pending.settle = setTimeout(() => {
                    if (session.pendingCommands.get(key) !== pending) return;
                    this._clearPendingCommand(key, pending, session);
                    session.transport.setError(new Error(
                        `Root motion completion watchdog stopped residual movement (command ${packet[1]})`
                    ));
                    resolve();
                }, MOTION_WATCHDOG_SETTLE_MS);
            }, motionWatchdogMs);
            session.pendingCommands.set(key, {
                resolve, reject, timeout, watchdog, settle: null, settling: false, stopMotion: true
            });
        });

        // Do not await Scratch Link/Scrub's JSON-RPC write promise. Some Scrub
        // versions leave it pending after CoreBluetooth has accepted the bytes.
        // The Scratch block waits only for Root's own matching Finished packet.
        try {
            const pendingWrite = session.transport.write(packet);
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this._rejectPendingCommand(key, error, session));
            }
        } catch (error) {
            this._rejectPendingCommand(key, error, session);
        }
        return completion;
    }

    _sendSoundAndWait (packet, durationMs, session = this._activeSession()) {
        return this._sendSoundCommandAndWait(packet, durationMs + SOUND_FINISH_GRACE_MS, 'sound', session);
    }

    _sendSoundCommandAndWait (packet, timeoutMs, description, session = this._activeSession()) {
        const key = this._commandKey(packet[0], packet[1], packet[2]);
        const completion = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const pending = session.pendingCommands.get(key);
                if (!pending) return;
                this._clearPendingCommand(key, pending, session);
                session.transport.setError(new Error(
                    `Root ${description} completion response timed out (packet ${packet[2]})`
                ));
                // Do not leave a Scratch stack stuck if a single notification
                // was lost after Root had enough time to finish the sound.
                resolve();
            }, timeoutMs);
            session.pendingCommands.set(key, {
                resolve, reject, timeout, watchdog: null, settle: null, settling: false, stopMotion: false
            });
        });

        try {
            const pendingWrite = session.transport.write(packet);
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this._rejectPendingCommand(key, error, session));
            }
        } catch (error) {
            this._rejectPendingCommand(key, error, session);
        }
        return completion;
    }

    _resolvePendingCommand (decoded, session = this._activeSession()) {
        const key = this._commandKey(decoded.device, decoded.command, decoded.packetId);
        const pending = session.pendingCommands.get(key);
        if (!pending) return false;
        // Explicitly zero the wheel speeds even after Root reports completion.
        // This prevents a residual velocity/controller correction from leaking
        // into the following Scratch command.
        if (pending.stopMotion && !pending.settling) this._sendMotionStop(key, session);
        this._clearPendingCommand(key, pending, session);
        pending.resolve();
        return true;
    }

    _sendMotionStop (pendingKey, session = this._activeSession()) {
        try {
            const pendingWrite = session.transport.write(session.protocol.motors(0, 0));
            if (pendingWrite && typeof pendingWrite.catch === 'function') {
                pendingWrite.catch(error => this._rejectPendingCommand(pendingKey, error, session));
            }
        } catch (error) {
            this._rejectPendingCommand(pendingKey, error, session);
        }
    }

    _clearPendingCommand (key, pending, session = this._activeSession()) {
        clearTimeout(pending.timeout);
        if (pending.watchdog) clearTimeout(pending.watchdog);
        if (pending.settle) clearTimeout(pending.settle);
        session.pendingCommands.delete(key);
    }

    _rejectPendingCommand (key, error, session = this._activeSession()) {
        const pending = session.pendingCommands.get(key);
        if (!pending) return false;
        this._clearPendingCommand(key, pending, session);
        session.transport.setError(error);
        pending.reject(error);
        return true;
    }

    _cancelPendingCommands (error, session = this._activeSession()) {
        for (const [key, pending] of session.pendingCommands) {
            this._clearPendingCommand(key, pending, session);
            pending.reject(error);
        }
    }

    _startEventHat (opcode, property, event, session = this._activeSession(), matchFields = {}) {
        if (property) session[property] = event;
        const previousDispatchSessionId = this._hatDispatchSessionId;
        this._hatDispatchSessionId = session.id;
        try {
            const hatOpcode = `${EXTENSION_ID}_${opcode}`;
            const threads = Object.keys(matchFields).length > 0 ?
                this.runtime.startHats(hatOpcode, matchFields) || [] :
                this.runtime.startHats(hatOpcode) || [];
            threads.forEach(thread => {
                thread.irobotRootSessionId = session.id;
                thread.irobotRootEventSessionId = session.id;
            });
            return threads;
        } finally {
            if (property) session[property] = null;
            this._hatDispatchSessionId = previousDispatchSessionId;
        }
    }

    _startBumperHat (event, session = this._activeSession()) {
        session.lastDetailedEvent = event;
        this._startFixedEventHat(event, session);
        const [bumper, action] = event.split('_');
        try {
            this._startEventHat('whenBumper', null, event, session, {BUMPER: bumper, ACTION: action});
        } catch (error) {
            // A parameterized hat saved by an older extension version can have
            // stale/missing fields. It must not prevent fixed hats or BLE I/O.
            session.transport.setError(error);
        }
    }

    _startTouchHat (event, session = this._activeSession()) {
        session.lastDetailedEvent = event;
        this._startFixedEventHat(event, session);
        const [sensor, action] = event.split('_');
        try {
            this._startEventHat('whenTouchSensor', null, event, session, {SENSOR: sensor, ACTION: action});
        } catch (error) {
            session.transport.setError(error);
        }
    }

    _startFixedEventHat (event, session = this._activeSession()) {
        const opcode = FIXED_EVENT_OPCODES[event];
        if (opcode) this._startEventHat(opcode, null, event, session);
    }

    _receiveBumperEvent (decoded, session = this._activeSession()) {
        const previous = session.bumperState;
        const next = (decoded.leftBumper ? 0x80 : 0) | (decoded.rightBumper ? 0x40 : 0);
        session.bumperState = next;

        if (previous === 0 && next === 0xC0) {
            this._startBumperHat('BOTH_PUSH', session);
            return;
        }
        if (previous === 0xC0 && next === 0) {
            this._startBumperHat('BOTH_RELEASE', session);
            return;
        }
        if ((previous ^ next) & 0x80) {
            this._startBumperHat(next & 0x80 ? 'LEFT_PUSH' : 'LEFT_RELEASE', session);
        }
        if ((previous ^ next) & 0x40) {
            this._startBumperHat(next & 0x40 ? 'RIGHT_PUSH' : 'RIGHT_RELEASE', session);
        }
    }

    _receiveTouchEvent (decoded, session = this._activeSession()) {
        const previous = session.touchState;
        const next = decoded.touchMask;
        session.touchState = next;
        const sensors = [['FL', 0x8], ['FR', 0x4], ['RR', 0x2], ['RL', 0x1]];
        for (const [sensor, mask] of sensors) {
            if ((previous ^ next) & mask) {
                this._startTouchHat(`${sensor}_${next & mask ? 'TOUCH' : 'RELEASE'}`, session);
            }
        }
    }

    _receive (packet, session = this._activeSession()) {
        // A connected physical Root may keep sending sensor notifications while
        // the student deliberately works in simulator-fixed mode. Never let
        // those events launch scripts for the virtual Root.
        if (this.controlMode === CONTROL_MODE_SIMULATOR ||
            (this.controlMode === CONTROL_MODE_AUTO && !session.isConnected())) return;
        const decoded = session.protocol.decode(packet);
        if (!decoded) return;
        session.last = Object.assign({}, session.last, decoded);
        this._resolvePendingCommand(decoded, session);
        if (decoded.command !== 0) return;
        if (decoded.device === 12) this._receiveBumperEvent(decoded, session);
        if (decoded.device === 17) this._receiveTouchEvent(decoded, session);
        const names = {12: 'BUMPER', 17: 'TOUCH', 20: 'CLIFF', 14: 'BATTERY'};
        const name = names[decoded.device];
        if (name) this._startEventHat('whenEvent', 'currentEvent', name, session);
    }

    _receiveSimulatorEvent (event) {
        if (!this._isSimulatorActive() || !event) return;
        if (event.type === 'bumper') {
            this._receiveBumperEvent({leftBumper: event.left, rightBumper: event.right});
        } else if (event.type === 'touch') {
            this._receiveTouchEvent({touchMask: event.mask});
        }
    }
}

export {
    arcMotionWatchdogMs,
    COMMAND_FINISH_TIMEOUT_MS,
    IrobotRootBlocks as default,
    IrobotRootBlocks as blockClass,
    linearMotionWatchdogMs,
    MOTION_WATCHDOG_SETTLE_MS,
    MOTION_COMMAND_GAP_MS,
    navigationMotionWatchdogMs,
    turnMotionWatchdogMs
};
