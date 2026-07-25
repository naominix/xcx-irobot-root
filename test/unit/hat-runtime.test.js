const Runtime = require('../../../scratch-editor/packages/scratch-vm/src/engine/runtime');
const Target = require('../../../scratch-editor/packages/scratch-vm/src/engine/target');
const ExtensionManager = require('../../../scratch-editor/packages/scratch-vm/src/extension-support/extension-manager');
const dispatch = require('../../../scratch-editor/packages/scratch-vm/src/dispatch/central-dispatch');
const {blockClass} = require('../../src/vm/extensions/block/index.js');

const createHat = (target, id, opcode, fields) => {
    target.blocks.createBlock({
        id,
        opcode,
        inputs: {},
        fields: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, {name, value}])),
        next: null,
        parent: null,
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0
    });
};

describe('iRobot Root hats in the real Scratch VM runtime', () => {
    test('starts only parameter-matching touch hats', () => {
        const runtime = new Runtime();
        const target = new Target(runtime);
        target.isStage = true;
        runtime.addTarget(target);
        runtime._hats.irobotRoot_whenTouchSensor = {edgeActivated: false, restartExistingThreads: false};
        runtime._primitives.irobotRoot_whenTouchSensor = () => true;

        createHat(target, 'flTouch', 'irobotRoot_whenTouchSensor', {SENSOR: 'FL', ACTION: 'TOUCH'});
        createHat(target, 'frTouch', 'irobotRoot_whenTouchSensor', {SENSOR: 'FR', ACTION: 'TOUCH'});
        createHat(target, 'flRelease', 'irobotRoot_whenTouchSensor', {SENSOR: 'FL', ACTION: 'RELEASE'});

        const threads = runtime.startHats('irobotRoot_whenTouchSensor', {SENSOR: 'fl', ACTION: 'touch'});

        expect(threads).toHaveLength(1);
        expect(threads[0].topBlock).toBe('flTouch');
    });

    test('starts every matching hat on multiple targets', () => {
        const runtime = new Runtime();
        runtime._hats.irobotRoot_whenBumper = {edgeActivated: false, restartExistingThreads: false};
        runtime._primitives.irobotRoot_whenBumper = () => true;

        for (const id of ['stage', 'sprite']) {
            const target = new Target(runtime);
            target.isStage = id === 'stage';
            runtime.addTarget(target);
            createHat(target, `${id}Hat`, 'irobotRoot_whenBumper', {BUMPER: 'BOTH', ACTION: 'PUSH'});
        }

        const threads = runtime.startHats('irobotRoot_whenBumper', {BUMPER: 'BOTH', ACTION: 'PUSH'});

        expect(threads).toHaveLength(2);
        expect(threads.map(thread => thread.topBlock).sort()).toEqual(['spriteHat', 'stageHat']);
    });

    test('starts parameterized and fixed touch hats through extension registration and packet decoding', () => {
        const runtime = new Runtime();
        const manager = new ExtensionManager(runtime);
        const testFormatMessage = message => message.default;
        testFormatMessage.setup = () => ({locale: 'ja', translations: {ja: {}}});
        blockClass.formatMessage = testFormatMessage;
        const extension = new blockClass(runtime);
        const serviceName = 'test_irobot_root_extension';
        dispatch.setServiceSync(serviceName, extension);
        runtime._registerExtensionPrimitives(manager._prepareExtensionInfo(serviceName, extension.getInfo()));

        const target = new Target(runtime);
        target.isStage = true;
        runtime.addTarget(target);
        createHat(target, 'realFlTouch', 'irobotRoot_whenTouchSensor', {SENSOR: 'FL', ACTION: 'TOUCH'});
        createHat(target, 'realFrTouch', 'irobotRoot_whenTouchSensor', {SENSOR: 'FR', ACTION: 'TOUCH'});
        createHat(target, 'fixedFlTouch', 'irobotRoot_whenFLTouch', {});
        createHat(target, 'fixedFrTouch', 'irobotRoot_whenFRTouch', {});

        extension._receive(extension.protocol.packet(17, 0, [0, 0, 0, 0, 0x80]));

        expect(extension.detailedEvent()).toBe('FL_TOUCH');
        expect(runtime.threads.map(thread => thread.topBlock)).toContain('realFlTouch');
        expect(runtime.threads.map(thread => thread.topBlock)).toContain('fixedFlTouch');
        expect(runtime.threads.map(thread => thread.topBlock)).not.toContain('realFrTouch');
        expect(runtime.threads.map(thread => thread.topBlock)).not.toContain('fixedFrTouch');
    });
});
