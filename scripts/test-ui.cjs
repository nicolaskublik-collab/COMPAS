const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'compas-ui-'));
app.setPath('userData', temporary);
const preload = path.join(temporary, 'preload.cjs');
fs.writeFileSync(preload, `
const {contextBridge} = require('electron');
const commands = []; let listener; let playing = false;
const song = {id:'demo', name:'Demo', artist:'Test', bpm:120, key:'C', pitchTargetKey:'C', pitchSemitones:0,
 clickOnly:false, markers:[], regions:[], metronome:{enabled:false,bpm:120,beats:4,volume:.6,outputChannel:-1},
 tracks:[{id:'track',name:'Piano',path:'C:/test.wav',volume:1,pan:0,muted:false,solo:false,pitchEnabled:true,outputChannel:-1}]};
const library = {songs:[song],setlists:[{id:'set',name:'Show',songIds:['demo'],masterVolume:1}]};
const metadata = {songId:'demo',preparationKey:'ready',durationFrames:480000,sampleRate:48000,cachedTracks:1,preparationMs:12,
 waveforms:[{id:'track',name:'Piano',minimum:[-.3,-.6],maximum:[.3,.6]}],trackAnalysis:[]};
const emit = event => setTimeout(()=>listener?.(event), 10);
contextBridge.exposeInMainWorld('multitracks', {
 loadLibrary:async()=>library, loadSettings:async()=>({selectedAudioApi:'asio',selectedAudioDevice:'1',selectedSampleRate:48000,bufferFrames:128,
 midiMappings:[],keyMappings:[],pads:{volume:.3,outputChannel:-1,fadeSeconds:1.5,followSong:false}}),
 saveLibrary:async value=>value, saveSettings:async value=>value,
 listAudioDevices:async()=>[{id:1,name:'Test',outputChannels:4,sampleRate:48000,sampleRates:[48000],isDefault:true}],
 audioCommand:async command=>{
  commands.push(command);
  if(command.action==='configure') emit({event:'device-ready',sampleRate:48000,bufferFrames:128,latencyFrames:256});
  if(command.action==='prepare') emit({...metadata,event:'prepared'});
  if(command.action==='play') { playing=true; emit({...metadata,event:'playing',positionFrames:0}); }
  if(command.action==='stop') { playing=false; emit({event:'stopped'}); }
  if(command.action==='pause') { playing=false; emit({event:'paused',sampleRate:48000,positionFrames:48000}); }
  if(command.action==='resume') { playing=true; emit({event:'resumed',sampleRate:48000,positionFrames:0}); }
  if(command.action==='pads') emit({event:'pads',key:command.key});
  if(command.action==='status') emit({event:'status',playing,sampleRate:48000,durationFrames:480000,positionFrames:0});
  return true;
 }, onAudioEvent:fn=>{listener=fn}, testCommands:()=>commands
});
`);

let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 900,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await window.loadFile(path.resolve(__dirname, '../index.html'));
  const evaluate = code => window.webContents.executeJavaScript(code);
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out: ' + expression);
  };
  await waitFor(`window.multitracks.testCommands().some(c=>c.action==='configure')`);
  assert.equal(await evaluate(`document.querySelectorAll('.pad-key').length`), 12);
  assert.equal(await evaluate(`document.querySelectorAll('#midi-learn-action option[value^="pad"]').length`), 13);
  await evaluate(`document.querySelector('[data-play-setlist-song-id="demo"]').click()`);
  await waitFor(`window.multitracks.testCommands().some(c=>c.action==='prepare') && document.querySelector('#status-message').textContent.includes('lista')`);
  assert.equal(await evaluate(`window.multitracks.testCommands().some(c=>c.action==='play')`), false);
  await evaluate(`document.querySelector('#play-button').click()`);
  await waitFor(`document.querySelector('#play-button').getAttribute('aria-label')==='Pausar'`);
  await evaluate(`document.querySelector('#stop-button').click()`);
  await waitFor(`document.querySelector('#play-button').getAttribute('aria-label')==='Reproducir'`);
  await new Promise(resolve => setTimeout(resolve, 30));
  await evaluate(`document.querySelector('#play-button').click()`);
  await waitFor(`window.multitracks.testCommands().some(c=>c.action==='resume')`);
  assert.equal(await evaluate(`window.multitracks.testCommands().filter(c=>c.action==='play').length`), 1);
  await evaluate(`document.querySelector('[data-pad="7"]').click()`);
  await waitFor(`document.querySelector('[data-pad="7"]').getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.querySelector('#stop-button').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-pad="7"]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('#pads-stop').click()`);
  await waitFor(`document.querySelectorAll('.pad-key[aria-pressed="true"]').length===0`);
  if (process.env.COMPAS_UI_SCREENSHOT) {
    await evaluate(`document.querySelector('.pads-panel').scrollIntoView({block:'center',behavior:'instant'});
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const picture = await window.webContents.capturePage();
    fs.writeFileSync(process.env.COMPAS_UI_SCREENSHOT, picture.toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('UI passed: preparation before Play, restart without reload, pads, independent Stop, MIDI/key actions.');
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); process.exitCode = 1; if (window) window.destroy(); app.exit(1); });
app.on('will-quit', () => {
  // Electron may still hold its profile open; remove only files created explicitly by this test.
  try { fs.unlinkSync(preload); } catch {}
});
