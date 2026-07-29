import {spawnSync} from 'node:child_process';
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const sourceProject = path.join(projectDirectory, 'projects', 'example.sb3');
const outputProject = path.join(projectDirectory, 'projects', 'root-unicorn-drawing.sb3');

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {encoding: 'utf8', ...options});
    if (result.status !== 0) {
        throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
};

// iRobot Education Python distances/radii are centimeters. Root BLE commands
// exposed by this extension use millimeters, so those values are multiplied by
// ten. The BLE protocol uses positive values for right/clockwise and negative
// values for left/counterclockwise.
const commands = [
    {type: 'marker', value: '1'},
    {type: 'drive', mm: 23},
    {type: 'turn', degrees: 90},
    {type: 'arc', radius: -34, degrees: -60},
    {type: 'turn', degrees: 180},
    {type: 'arc', radius: 34, degrees: 60},
    {type: 'drive', mm: 94},
    {type: 'arc', radius: 34, degrees: 50},
    {type: 'turn', degrees: 145},
    {type: 'arc', radius: -48, degrees: -75},
    {type: 'turn', degrees: 180},
    {type: 'arc', radius: 48, degrees: 75},
    {type: 'turn', degrees: 35},
    {type: 'arc', radius: 34, degrees: 100},
    {type: 'drive', mm: 126.2},
    {type: 'turn', degrees: -90},
    {type: 'drive', mm: -20},
    {type: 'drive', mm: 147.1},
    {type: 'turn', degrees: -165},
    {type: 'drive', mm: 132},
    {type: 'turn', degrees: 75},
    {type: 'drive', mm: 31},
    {type: 'turn', degrees: 45},
    {type: 'arc', radius: 34, degrees: 135},
    {type: 'turn', degrees: 120},
    {type: 'arc', radius: -18, degrees: -115},
    {type: 'marker', value: '0'},
    {type: 'drive', mm: 30},
    {type: 'marker', value: '1'},
    {type: 'arc', radius: 132, degrees: 210},
    {type: 'arc', radius: -68.5, degrees: -60},
    {type: 'turn', degrees: 90},
    {type: 'arc', radius: 55.8, degrees: 145},
    {type: 'arc', radius: -88.5, degrees: -190},
    {type: 'turn', degrees: -90},
    {type: 'marker', value: '0'},
    {type: 'drive', mm: 80},
    {type: 'marker', value: '1'},
    {type: 'turn', degrees: 30},
    {type: 'arc', radius: 20, degrees: 135},
    {type: 'marker', value: '0'},
    {type: 'turn', degrees: -85},
    {type: 'drive', mm: 65},
    {type: 'turn', degrees: 90},
    {type: 'marker', value: '1'},
    {type: 'arc', radius: -5, degrees: -180},
    {type: 'marker', value: '0'},
    {type: 'drive', mm: -200}
];

const numberInput = value => [1, [4, String(value)]];
const blocks = {};
const hatId = 'root-unicorn-when-flag';
const commandIds = commands.map((unused, index) => `root-unicorn-command-${String(index + 1).padStart(2, '0')}`);

blocks[hatId] = {
    opcode: 'event_whenflagclicked',
    next: commandIds[0],
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 44,
    y: 44
};

commands.forEach((command, index) => {
    const blockId = commandIds[index];
    const block = {
        opcode: `irobotRoot_${command.type}`,
        next: commandIds[index + 1] || null,
        parent: index === 0 ? hatId : commandIds[index - 1],
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false
    };

    if (command.type === 'drive') {
        block.inputs.MM = numberInput(command.mm);
    } else if (command.type === 'turn') {
        block.inputs.DEGREES = numberInput(command.degrees);
    } else if (command.type === 'arc') {
        block.inputs.RADIUS = numberInput(command.radius);
        block.inputs.DEGREES = numberInput(command.degrees);
    } else if (command.type === 'marker') {
        const menuId = `${blockId}-menu`;
        block.inputs.POSITION = [1, menuId];
        blocks[menuId] = {
            opcode: 'irobotRoot_menu_markerMenu',
            next: null,
            parent: blockId,
            inputs: {},
            fields: {markerMenu: [command.value]},
            shadow: true,
            topLevel: false
        };
    }

    blocks[blockId] = block;
});

const projectJson = JSON.parse(run('unzip', ['-p', sourceProject, 'project.json']));
const sprite = projectJson.targets.find(target => !target.isStage);
sprite.blocks = blocks;
sprite.comments = {};
projectJson.extensions = ['irobotRoot'];
projectJson.extensionURLs = [[
    'irobotRoot',
    'https://naominix.github.io/xcx-irobot-root/dist/irobotRoot.mjs'
]];
projectJson.meta.agent = 'Codex iRobot Root unicorn drawing project generator';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'root-unicorn-project-'));
const temporaryJson = path.join(temporaryDirectory, 'project.json');

try {
    await writeFile(temporaryJson, `${JSON.stringify(projectJson, null, 2)}\n`);
    await copyFile(sourceProject, outputProject);
    run('zip', ['-d', outputProject, 'project.json']);
    run('zip', ['-q', '-j', outputProject, temporaryJson]);

    // Verify that the archive contains the project we just generated.
    const archivedJson = JSON.parse(run('unzip', ['-p', outputProject, 'project.json']));
    const archivedSprite = archivedJson.targets.find(target => !target.isStage);
    if (Object.keys(archivedSprite.blocks).length !== Object.keys(blocks).length) {
        throw new Error('Generated project verification failed');
    }
} finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
}

const size = (await readFile(outputProject)).byteLength;
console.log(`Created ${outputProject} (${commands.length} commands, ${size} bytes)`);
