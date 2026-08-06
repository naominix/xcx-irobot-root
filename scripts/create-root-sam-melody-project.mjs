import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceProject = join(repositoryRoot, 'projects', 'example.sb3');
const outputProject = join(repositoryRoot, 'projects', 'root-sam-melody.sb3');
const workDirectory = mkdtempSync(join(tmpdir(), 'root-sam-melody-'));

const melody = [
    {name: 'G3', midi: 55, milliseconds: 250},
    {name: 'G3', midi: 55, milliseconds: 250},
    {name: 'D4', midi: 62, milliseconds: 250},
    {name: 'D4', midi: 62, milliseconds: 250},
    {name: 'E4', midi: 64, milliseconds: 250},
    {name: 'E4', midi: 64, milliseconds: 250},
    {name: 'D4', midi: 62, milliseconds: 500},
    {name: 'C4', midi: 60, milliseconds: 250},
    {name: 'C4', midi: 60, milliseconds: 250},
    {name: 'B3', midi: 59, milliseconds: 250},
    {name: 'B3', midi: 59, milliseconds: 250},
    {name: 'A3', midi: 57, milliseconds: 250},
    {name: 'A3', midi: 57, milliseconds: 250},
    {name: 'G3', midi: 55, milliseconds: 500}
];

execFileSync('unzip', ['-q', sourceProject, '-d', workDirectory]);

const projectJsonPath = join(workDirectory, 'project.json');
const project = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
const sprite = project.targets.find(target => !target.isStage);

if (!sprite) throw new Error('The source project does not contain a sprite.');

const blocks = {
    'root-melody-when-flag': {
        opcode: 'event_whenflagclicked',
        next: 'root-melody-note-01',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 60,
        y: 60
    }
};

melody.forEach((tone, index) => {
    const number = String(index + 1).padStart(2, '0');
    const nextNumber = String(index + 2).padStart(2, '0');
    const noteId = `root-melody-note-${number}`;
    const noteShadowId = `root-melody-note-shadow-${number}`;
    const previousId = index === 0 ? 'root-melody-when-flag' :
        `root-melody-note-${String(index).padStart(2, '0')}`;

    blocks[noteId] = {
        opcode: 'irobotRoot_playNote',
        next: index === melody.length - 1 ? null : `root-melody-note-${nextNumber}`,
        parent: previousId,
        inputs: {
            NOTE: [1, noteShadowId],
            MS: [1, [4, String(tone.milliseconds)]]
        },
        fields: {},
        shadow: false,
        topLevel: false
    };

    blocks[noteShadowId] = {
        opcode: 'note',
        next: null,
        parent: noteId,
        inputs: {},
        fields: {NOTE: [String(tone.midi), null]},
        shadow: true,
        topLevel: false
    };
});

sprite.blocks = blocks;
project.extensions = ['irobotRoot'];
project.extensionURLs = [[
    'irobotRoot',
    'https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs'
]];
project.meta = {
    ...project.meta,
    projectName: 'SAM Root Melody'
};

writeFileSync(projectJsonPath, `${JSON.stringify(project)}\n`);
execFileSync('zip', ['-q', '-r', outputProject, '.'], {cwd: workDirectory});

console.log(outputProject);
