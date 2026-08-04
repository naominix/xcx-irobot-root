import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceProject = join(repositoryRoot, 'projects', 'example.sb3');
const outputProject = join(repositoryRoot, 'projects', 'root-sam-melody.sb3');
const workDirectory = mkdtempSync(join(tmpdir(), 'root-sam-melody-'));

const melody = [
    {name: 'G3', hz: 196, milliseconds: 250},
    {name: 'G3', hz: 196, milliseconds: 250},
    {name: 'D4', hz: 294, milliseconds: 250},
    {name: 'D4', hz: 294, milliseconds: 250},
    {name: 'E4', hz: 330, milliseconds: 250},
    {name: 'E4', hz: 330, milliseconds: 250},
    {name: 'D4', hz: 294, milliseconds: 500},
    {name: 'C4', hz: 262, milliseconds: 250},
    {name: 'C4', hz: 262, milliseconds: 250},
    {name: 'B3', hz: 247, milliseconds: 250},
    {name: 'B3', hz: 247, milliseconds: 250},
    {name: 'A3', hz: 220, milliseconds: 250},
    {name: 'A3', hz: 220, milliseconds: 250},
    {name: 'G3', hz: 196, milliseconds: 500}
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
    const previousId = index === 0 ? 'root-melody-when-flag' :
        `root-melody-note-${String(index).padStart(2, '0')}`;

    blocks[noteId] = {
        opcode: 'irobotRoot_note',
        next: index === melody.length - 1 ? null : `root-melody-note-${nextNumber}`,
        parent: previousId,
        inputs: {
            HZ: [1, [4, String(tone.hz)]],
            MS: [1, [4, String(tone.milliseconds)]]
        },
        fields: {},
        shadow: false,
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
