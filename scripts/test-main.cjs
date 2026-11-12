const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'compas-main-'));
  const source = path.resolve(__dirname, '../main.cjs');
  const commands = [];
  let stats = 0;
  let unblock;
  const baseRequire = createRequire(source);
  const electron = { app: { whenReady: () => new Promise(() => {}), on() {},
    getPath: () => temporary, isPackaged: false }, ipcMain: { handle() {} }, BrowserWindow: {}, dialog: {} };
  const filesystem = { ...fs.promises, stat: async filename => {
    stats++;
    if (filename.endsWith('slow.wav')) await new Promise(resolve => { unblock = resolve; });
    return { isFile: () => true, size: 1000, mtimeMs: 1234 };
  } };
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.stdin = new Writable({ write(chunk, _encoding, done) { commands.push(JSON.parse(chunk.toString())); done(); } });
  const context = vm.createContext({ console, process, Buffer, setTimeout, clearTimeout, structuredClone,
    __dirname: path.dirname(source), require: name => {
      if (name === 'electron') return electron;
      if (name === 'node:fs/promises') return filesystem;
      if (name === 'node:child_process') return { ...baseRequire(name), spawn() {
        setImmediate(() => child.stdout.write('{"event":"ready"}\n')); return child;
      } };
      return baseRequire(name);
    } });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  context.testDirectory = temporary;
  await vm.runInContext(`(async()=>{
    libraryPath = require('node:path').join(testDirectory, 'library.json');
    settingsPath = require('node:path').join(testDirectory, 'settings.json');
    settings = { ...DEFAULT_SETTINGS, selectedAudioDevice:'1', pads:{...DEFAULT_SETTINGS.pads} };
    library = { songs:[{id:'song',name:'Test',artist:'Test',bpm:120,key:'C',pitchTargetKey:'C',pitchSemitones:0,
      clickOnly:false,markers:[],regions:[],metronome:{...DEFAULT_METRONOME},
      tracks:[{id:'track',name:'Test',path:'C:/test.wav',volume:1,pan:0,muted:false,solo:false,pitchEnabled:true,outputChannel:-1}]}],
      setlists:[{id:'set',name:'Show',songIds:['song'],masterVolume:1}] };
    await saveLibrary(library); await saveSettings(settings);
  })()`, context);
  context.command = { action: 'prepare', songId: 'song', setlistId: 'set', startOffsetSeconds: 0,
    masterVolume: 1, setlistVolume: 1,
    tracks: [{ id: 'track', volume: 1, pan: 0, outputChannel: -1, pitchEnabled: true }] };
  await vm.runInContext('sendAudioCommand(command)', context);
  assert.equal(commands.at(-1).action, 'prepare');
  const beforePlay = stats;
  context.key = commands.at(-1).preparationKey;
  await vm.runInContext(`sendAudioCommand({...command,action:'play',preparationKey:key})`, context);
  assert.equal(stats, beforePlay, 'prepared Play must not touch the disk');
  assert.equal(commands.at(-1).preparationKey, context.key);
  await vm.runInContext(`sendAudioCommand({action:'pads',key:7})`, context);
  assert.equal(commands.at(-1).key, 7);
  await assert.rejects(vm.runInContext(`sendAudioCommand({action:'pads',key:12})`, context));
  await vm.runInContext(`Promise.all([saveSettings({...settings,pads:{...settings.pads,volume:.2}}),
    saveSettings({...settings,pads:{...settings.pads,volume:.8}})])`, context);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'settings.json'))).pads.volume, 0.8);
  vm.runInContext(`library.songs[0].tracks[0].path = 'C:/slow.wav'`, context);
  const delayed = vm.runInContext(`sendAudioCommand({...command,action:'play'})`, context);
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  await vm.runInContext(`sendAudioCommand({action:'stop'})`, context);
  unblock();
  assert.equal(await delayed, false, 'Stop cancels a Play waiting on filesystem work');
  assert.equal(commands.at(-1).action, 'stop');
  fs.rmSync(temporary, { recursive: true });
  console.log('Main passed: validation, disk-free prepared Play, serialized saves, cancellation before dispatch.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
