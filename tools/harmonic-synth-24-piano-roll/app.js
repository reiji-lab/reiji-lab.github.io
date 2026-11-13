(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_LANES = 40, MAX_PARTIALS = 24, MAX_NOTES = 512, LABEL_WIDTH = 282;
  const TET_MIN_MIDI = 36, TET_MAX_MIDI = 95; // C2 through B6 (5 octaves)
  const PITCH_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const PITCH_FLATS = ['','D♭','','E♭','','','G♭','','A♭','','B♭',''];
  const noteName = midi => PITCH_NAMES[midi%12] + (Math.floor(midi/12)-1);
  const alternateName = midi => PITCH_FLATS[midi%12] ? PITCH_FLATS[midi%12] + (Math.floor(midi/12)-1) : '';
  const isBlackKey = midi => [1,3,6,8,10].includes(midi%12);
  const newTetLane = midi => ({id:id('lane-'),midi,volume:85,name:noteName(midi),notes:[]});
  const makeTetLanes = () => Array.from({length:TET_MAX_MIDI-TET_MIN_MIDI+1}, (_,i)=>newTetLane(TET_MAX_MIDI-i));
  const waves = [['sine','正弦波'],['triangle','三角波'],['sawtooth','ノコギリ波'],['square','矩形波']];
  const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));
  const fmt = x => Number(x.toFixed(6)).toString();
  // A beat is a quarter note. Retain rational triplet positions internally
  // instead of converting 1/3 into a rounded four-decimal decimal.
  const beatString = value => {
    const x = Number(value);
    for (const denominator of [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]) {
      const numerator = Math.round(x * denominator);
      if (Math.abs(x - numerator / denominator) < 1e-8) {
        let a = numerator, b = denominator;
        const gcd = (m,n) => n ? gcd(n,m%n) : m;
        const g = gcd(Math.abs(a),b);
        a /= g; b /= g;
        return b===1 ? String(a) : `${a}/${b}`;
      }
    }
    return fmt(x);
  };
  const parseBeat = raw => {
    const s = String(raw).trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?$/.test(s))
      throw Error('拍数は 1/3、2/3、0.5、1 のように入力してください。');
    const [num,den='1'] = s.split('/').map(Number);
    const n = num/den;
    if (!Number.isFinite(n) || n < 0) throw Error('拍数は0以上で、分母は0以外にしてください。');
    return n;
  };
  const fixedHz = x => x >= 1000 ? x.toLocaleString('ja-JP',{maximumFractionDigits:1}) : x.toFixed(2);
  const status = (msg, cls='') => { $('status').textContent=msg; $('status').className='status '+cls; };
  const sequenceStatus = (msg,cls='') => {$('sequenceStatus').textContent=msg; $('sequenceStatus').className='sequence-status '+cls;};
  const announceError = e => sequenceStatus(e?.message || String(e),'err');
  function parseRatio(input) {
    const s = String(input).trim();
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?$/.test(s)) throw Error(`「${s}」は比率の形式ではありません。例：3/2、23/16`);
    const [a,b='1'] = s.split('/').map(Number), v=a/b;
    if (!Number.isFinite(v) || v<=0) throw Error('比率は正の値にしてください（分母0不可）。');
    return v;
  }
  let nextID = 1;
  const id = prefix => prefix + (nextID++);
  const newNote = (start,duration,volume=100) => ({id:id('note-'),start,duration,volume});
  const newLane = (ratio='1/1',name='') => ({id:id('lane-'),ratio,volume:85,name,notes:[]});
  // Default data is exactly the JSON saved by Reiji. Do not reduce ratios,
  // quantize beats, re-sort note events, or reinterpret tuning symbols.
  const DEFAULT_SONG = window.REIJI_DEFAULT_SONG;
  if (!DEFAULT_SONG || DEFAULT_SONG.format !== 'reiji-lab-ratio-piano-roll') {
    throw Error('初期演奏データを読み込めませんでした。default-data.js を確認してください。');
  }
  function makeDefaultLanes() {
    return DEFAULT_SONG.lanes.map(lane => ({
      id:id('lane-'),name:lane.name,ratio:lane.ratio,volume:lane.volume,
      notes:lane.notes.map(note=>newNote(note.start,note.duration,note.volume))
    }));
  }
  let baseHz=DEFAULT_SONG.baseHz, master=DEFAULT_SONG.master,
      tempo=DEFAULT_SONG.tempo, beatsPerBar=DEFAULT_SONG.beatsPerBar,
      bars=DEFAULT_SONG.bars, snap=DEFAULT_SONG.snap, beatPx=54;
  let ratioLanes=makeDefaultLanes(), tetLanes=makeTetLanes();
  let rollMode='ratio', a4Hz=440, tetFirstVisit=true;
  let lanes=ratioLanes, selected=null;
  const laneFrequency = lane => rollMode==='tet'?a4Hz*Math.pow(2,(lane.midi-69)/12):baseHz*parseRatio(lane.ratio);
  const laneName = lane => rollMode==='tet'?noteName(lane.midi):(lane.name||lane.ratio);
  const cloneLanes = list => list.map(l=>({id:id('lane-'),name:l.name||'',ratio:l.ratio,midi:l.midi,volume:l.volume,notes:l.notes.map(n=>newNote(n.start,n.duration,n.volume))}));
  const savedLanes = list => list.map(l=>({name:l.name, ...(Number.isInteger(l.midi)?{midi:l.midi}:{ratio:l.ratio}),volume:l.volume,notes:l.notes.map(n=>({start:n.start,duration:n.duration,volume:n.volume}))}));
  const currentRatioLanes = () => rollMode==='ratio'?lanes:ratioLanes;
  const currentTetLanes = () => rollMode==='tet'?lanes:tetLanes;
  let partials=DEFAULT_SONG.partials.map(p=>({...p}));
  let ctx=null, masterGain=null, analyser=null, previewBus=null, audition=false;
  let oscBank=[],gainBank=[], sequenceBus=null, sequenceNodes=new Set(),playing=false;
  let sequenceStart=0, sequenceEnd=0, seqCount=0, raf=0, timeArray=null;
  // A recorded sample is intentionally NOT embedded in song JSON. Export its WAV separately.
  let soundSource='synth', sampleBuffer=null, sampleReferenceHz=DEFAULT_SONG.baseHz;
  let sampleFilename='', micRecorder=null, micStream=null, micChunks=[], micTimer=null;
  let samplePreviewNodes=new Set();

  function makePartials(type='organ') {
    return Array.from({length:MAX_PARTIALS},(_,i)=>({level:type==='pure'?(i===0?100:0):type==='organ'?(i<12?Math.round(100/(i+1)**1.05):0):type==='string'?Math.max(0,Math.round(90/(i+1)**.75-(i>14?4:0))):type==='odd'?(i%2===0?Math.round(95/(i+1)**.72):0):type==='twentythree'?(i===0?75:i===22?48:0):i===0?100:0,wave:'sine',muted:false}));
  }
  function syncPower() {
    const active=audition||playing;
    $('powerDot').classList.toggle('on',active);
    $('powerLabel').textContent=playing?'自動演奏中':audition?'音色試聴中':'停止中';
    $('playButton').textContent=audition?'■ 試聴を停止':soundSource==='sample'?'♪ サンプルを試聴':'♪ 音色を試聴';
    $('sequencePlay').textContent=playing?'↻ 最初から再生':'▶ 自動演奏';
    $('sequenceStop').disabled=!playing;
    $('waveLabel').textContent=active?'実際の出力波形':'計算上の波形';
  }
  async function setupAudio() {
    if(!ctx){
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass) throw Error('Web Audio APIに対応していないブラウザです。');
      ctx=new AudioContextClass({latencyHint:'interactive'});
      masterGain=ctx.createGain();masterGain.gain.value=master/100;
      const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=5;compressor.ratio.value=16;compressor.attack.value=.003;compressor.release.value=.15;
      analyser=ctx.createAnalyser();analyser.fftSize=4096;
      masterGain.connect(compressor);compressor.connect(analyser);analyser.connect(ctx.destination);
      previewBus=ctx.createGain();previewBus.gain.value=0;previewBus.connect(masterGain);
      for(let i=0;i<MAX_PARTIALS;i++){
        const osc=ctx.createOscillator(), gain=ctx.createGain();
        osc.type='sine';osc.frequency.value=baseHz*(i+1);gain.gain.value=0;
        osc.connect(gain);gain.connect(previewBus);osc.start();
        oscBank.push(osc);gainBank.push(gain);
      }
      timeArray=new Uint8Array(analyser.fftSize);
      refreshAudio();
    }
    await ctx.resume();
  }
  function refreshAudio(){
    if(!ctx)return;
    const now=ctx.currentTime;
    const levels=partials.map((p,i)=>p.muted||baseHz*(i+1)>=ctx.sampleRate/2?0:p.level/100);
    const power=Math.sqrt(levels.reduce((a,b)=>a+b*b,0));
    previewBus.gain.setTargetAtTime(audition ? .55/Math.max(1,power):0,now,.012);
    masterGain.gain.setTargetAtTime(master/100,now,.02);
    partials.forEach((p,i)=>{
      oscBank[i].type=p.wave;
      oscBank[i].frequency.setTargetAtTime(baseHz*(i+1),now,.01);
      gainBank[i].gain.setTargetAtTime(levels[i],now,.012);
    });
  }
  function makePeriodicWave(freq,snapshot,cache){
    const limit=Math.min(1024,Math.floor((ctx.sampleRate/2-.1)/freq));
    if(limit<1)throw Error('音が再生可能な周波数を超えています。');
    if(cache.has(limit))return cache.get(limit);
    const real=new Float32Array(limit+1),imag=new Float32Array(limit+1);
    let sum=0;
    snapshot.forEach((p,i)=>{if(!p.muted && i+1<=limit)sum+=(p.level/100)**2;});
    snapshot.forEach((p,i)=>{
      const n=i+1;if(p.muted||p.level===0||n>limit)return;
      const level=p.level/100;
      for(let harmonic=1;harmonic*n<=limit;harmonic++){
        let factor=0;
        switch(p.wave){
          case 'sine':factor=harmonic===1?1:0;break;
          case 'square':factor=harmonic%2?4/(Math.PI*harmonic):0;break;
          case 'triangle':factor=harmonic%2?8/(Math.PI*Math.PI*harmonic**2)*(harmonic%4===1?1:-1):0;break;
          case 'sawtooth':factor=2/(Math.PI*harmonic)*(harmonic%2?1:-1);break;
        }
        imag[harmonic*n]+=level*factor;
      }
    });
    const res={wave:ctx.createPeriodicWave(real,imag,{disableNormalization:true}),scale:.55/Math.max(1,Math.sqrt(sum))};
    cache.set(limit,res);return res;
  }
  function scheduleNote(bus, at, duration, frequency, volume, snapshot,cache,headroom, nodes) {
    if(frequency<20||frequency>=ctx.sampleRate/2)throw Error(`${fixedHz(frequency)} Hzは再生可能な範囲外です。比率または基準周波数を調整してください。`);
    const {wave,scale}=makePeriodicWave(frequency,snapshot,cache);
    const osc=ctx.createOscillator(),env=ctx.createGain();
    osc.setPeriodicWave(wave);osc.frequency.value=frequency;
    const attack=Math.min(.014,duration*.2),release=Math.min(.06,duration*.22);
    const level=scale*volume*headroom;
    env.gain.setValueAtTime(0,at);
    env.gain.linearRampToValueAtTime(level,at+attack);
    env.gain.setValueAtTime(level,Math.max(at+attack,at+duration-release));
    env.gain.linearRampToValueAtTime(0,at+duration);
    osc.connect(env);env.connect(bus);
    const node={osc,env};nodes.add(node);
    osc.onended=()=>{try{osc.disconnect();env.disconnect();}catch(_e){}nodes.delete(node);};
    osc.start(at);osc.stop(at+duration+.03);
    return node;
  }
  function scheduleSampleNote(bus, at, duration, frequency, volume, headroom, nodes){
    if(!sampleBuffer)throw Error('サンプリング音源が未登録です。マイクで録音するか、音声ファイルを読み込んでください。');
    const playbackRate=frequency/sampleReferenceHz;
    if(!Number.isFinite(playbackRate)||playbackRate<=0||playbackRate>16||playbackRate<0.0625)
      throw Error('サンプリング音源と指定音高が離れすぎています。基準周波数を調整してください（移調は±4オクターブまで）。');
    const src=ctx.createBufferSource(), env=ctx.createGain();
    src.buffer=sampleBuffer;src.loop=true;src.loopStart=0;src.loopEnd=sampleBuffer.duration;
    src.playbackRate.value=playbackRate;
    const attack=Math.min(.018,duration*.20),release=Math.min(.07,duration*.23);
    const level=volume*headroom*.75;
    env.gain.setValueAtTime(0,at);
    env.gain.linearRampToValueAtTime(level,at+attack);
    env.gain.setValueAtTime(level,Math.max(at+attack,at+duration-release));
    env.gain.linearRampToValueAtTime(0,at+duration);
    src.connect(env);env.connect(bus);
    const node={osc:src,env};nodes.add(node);
    src.onended=()=>{try{src.disconnect();env.disconnect();}catch(_e){}nodes.delete(node);};
    src.start(at);src.stop(at+duration+.03);
    return node;
  }
  function scheduleActiveNote(bus,at,duration,frequency,volume,snapshot,cache,headroom,nodes){
    return soundSource==='sample'
      ? scheduleSampleNote(bus,at,duration,frequency,volume,headroom,nodes)
      : scheduleNote(bus,at,duration,frequency,volume,snapshot,cache,headroom,nodes);
  }
  async function previewLane(lane){
    const freq=laneFrequency(lane);
    await setupAudio();
    const cache=new Map(),nodes=new Set(),bus=ctx.createGain();bus.connect(masterGain);
    scheduleActiveNote(bus,ctx.currentTime+.02,.65,freq,lane.volume/100,partials.map(p=>({...p})),cache,.7,nodes);
    setTimeout(()=>{try{bus.disconnect();}catch(_e){}},1250);
    status(`${laneName(lane)}：${fixedHz(freq)} Hz を試聴しました。`);
    animate();
  }
  function stopSequence(announce=true){
    const now=ctx?.currentTime||0;
    if(sequenceBus){
      sequenceBus.gain.cancelScheduledValues(now);
      sequenceBus.gain.setTargetAtTime(0,now,.006);
      const oldBus=sequenceBus;
      setTimeout(()=>{try{oldBus.disconnect();}catch(_e){}},250);
    }
    for(const node of sequenceNodes){try{node.osc.stop(now+.04);}catch(_e){}}
    sequenceNodes.clear();sequenceBus=null;playing=false;sequenceEnd=0;
    const head=$('playhead');if(head)head.style.display='none';
    syncPower();if(announce)sequenceStatus('演奏を停止しました。');
    if(!audition)drawVisuals();
  }
  function songEvents(){
    const events=[];
    for(const lane of lanes){
      const freq=laneFrequency(lane);
      for(const note of lane.notes){events.push({freq,start:note.start,duration:note.duration,volume:lane.volume*note.volume/10000});}
    }
    if(events.length===0)throw Error('音符がありません。タイムラインの空白をクリックして配置してください。');
    if(events.length>MAX_NOTES)throw Error('1曲の音符は512個以内にしてください。');
    if(totalBeats()*60/tempo>600)throw Error('演奏時間が10分を超えます。テンポや小節数を調整してください。');
    return events;
  }
  async function startSequence(){
    const events=songEvents();if(soundSource==='sample'&&!sampleBuffer)throw Error('録音音源を読み込んでから再生してください。');await setupAudio();
    if(playing)stopSequence(false);
    if(audition){audition=false;refreshAudio();}
    const bus=ctx.createGain();bus.gain.value=1;bus.connect(masterGain);sequenceBus=bus;
    const snapShot=partials.map(p=>({...p})),cache=new Map(), start=ctx.currentTime+.12;
    const secs=60/tempo,headroom=0.8/Math.sqrt(Math.max(1,Math.min(40,lanes.filter(l=>l.notes.length).length)));
    try{
      for(const event of events){scheduleActiveNote(bus,start+event.start*secs,event.duration*secs,event.freq,event.volume,snapShot,cache,headroom,sequenceNodes);}
    }catch(e){stopSequence(false);throw e;}
    sequenceStart=start;sequenceEnd=start+totalBeats()*secs;seqCount=events.length;playing=true;
    syncPower();sequenceStatus(`再生中：${events.length}音 / ${lanes.length}音階行 / ${tempo} BPM / ${soundSource==='sample'?'サンプリング音源':'24倍音合成音'}。音源変更は次の再生から反映されます。`);
    animate();
  }

  const mixer=$('mixer');
  for(let i=0;i<MAX_PARTIALS;i++){
    const n=i+1,el=document.createElement('div');el.className='harmonic';
    el.innerHTML=`<div class="harmonic-top"><div class="harmonic-num">${String(n).padStart(2,'0')}</div><div class="harmonic-name"><strong>第${n}倍音</strong><small class="hfreq">${fixedHz(baseHz*n)} Hz</small></div><button class="mute" type="button" aria-pressed="false">ミュート</button></div><div class="harmonic-bottom"><select aria-label="第${n}倍音の波形">${waves.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select><input type="range" min="0" max="100" step="1" aria-label="第${n}倍音の音量"><output></output></div>`;
    mixer.append(el);
    el.querySelector('select').addEventListener('change',e=>{partials[i].wave=e.target.value;refreshAudio();drawVisuals();$('preset').value='custom';});
    el.querySelector('input').addEventListener('input',e=>{partials[i].level=Number(e.target.value);el.querySelector('output').textContent=partials[i].level+'%';refreshAudio();drawVisuals();$('preset').value='custom';});
    el.querySelector('.mute').addEventListener('click',()=>{partials[i].muted=!partials[i].muted;renderMixer();refreshAudio();drawVisuals();$('preset').value='custom';});
  }
  function renderMixer(){
    Array.from(mixer.children).forEach((el,i)=>{
      const p=partials[i];el.querySelector('select').value=p.wave;
      el.querySelector('input').value=p.level;
      el.querySelector('output').textContent=p.level+'%';
      el.querySelector('.hfreq').textContent=fixedHz(baseHz*(i+1))+' Hz';
      el.classList.toggle('is-muted',p.muted);
      const b=el.querySelector('.mute');b.textContent=p.muted?'解除':'ミュート';b.setAttribute('aria-pressed',String(p.muted));
    });
  }
  function setTimbrePreset(type){partials=makePartials(type);renderMixer();refreshAudio();drawVisuals();}
  $('preset').addEventListener('change',e=>{if(e.target.value!=='custom')setTimbrePreset(e.target.value);});
  $('resetTimbre').addEventListener('click',()=>{setTimbrePreset('organ');$('preset').value='organ';status('音色だけを初期化しました。');});
  $('master').addEventListener('input',e=>{master=Number(e.target.value);$('masterValue').textContent=master+'%';refreshAudio();});
  $('baseHz').addEventListener('change',e=>{
    const value=Number(e.target.value);
    if(!Number.isFinite(value)||value<20||value>2000){e.target.value=String(baseHz);status('基準周波数は20〜2000 Hzで指定してください。','err');return;}
    baseHz=value;refreshAudio();renderMixer();renderRoll();drawVisuals();
  });
  $('playButton').addEventListener('click',async()=>{
    try{
      if(soundSource==='sample'){
        if(!sampleBuffer)throw Error('録音した音か音声ファイルを用意してください。');
        await playSamplePreview();
        return;
      }
      if(!audition){await setupAudio();if(playing)stopSequence(false);audition=true;}else audition=false;
      refreshAudio();syncPower();animate();status(audition?'音色を試聴中です。':'音色の試聴を停止しました。');}
    catch(e){status(e.message,'err');}
  });

  const totalBeats=()=>beatsPerBar*bars;
  const snapTo=(v)=>Math.round(v/snap)*snap;
  const isTripletGrid=()=>[2/3,1/3,1/6].some(v=>Math.abs(snap-v)<1e-10);
  // On a triplet grid, one click creates a single triplet note.
  // Otherwise preserve the previous default of one quarter note.
  const newNoteDuration=()=>isTripletGrid()?snap:1;
  const currentGridText=()=>isTripletGrid()?`3連符（${beatString(snap)}拍刻み）`:`${beatString(snap)}拍刻み`;
  const allNotes=()=>lanes.reduce((sum,lane)=>sum+lane.notes.length,0);
  const getSelected=()=>{if(!selected)return null;const lane=lanes.find(l=>l.id===selected.laneId);const note=lane?.notes.find(n=>n.id===selected.noteId);return lane&&note?{lane,note}:null;};
  function renderInspector(){
    const s=getSelected(),enabled=!!s;
    ['noteStart','noteDuration','noteVolume','deleteNote'].forEach(key=>{$(key).disabled=!enabled;});
    $('selectionName').textContent=s?(rollMode==='tet'?`${noteName(s.lane.midi)}（12平均律 / MIDI ${s.lane.midi}）`:`${s.lane.name||s.lane.ratio}（${s.lane.ratio}）`):'音符を選択してください';
    if(s){
      $('noteStart').value=beatString(s.note.start);$('noteDuration').value=beatString(s.note.duration);$('noteVolume').value=s.note.volume;
      $('positionLabel').textContent=`第${Math.floor((s.note.start+1e-9)/beatsPerBar)+1}小節 / ${beatString(s.note.start%beatsPerBar+1)}拍目 → 長さ ${beatString(s.note.duration)}拍。1拍は4分音符です。`;
    }else{$('noteStart').value='';$('noteDuration').value='';$('noteVolume').value='';$('positionLabel').textContent=rollMode==='tet'?'空白をクリックすると、その行の12平均律の音符が追加されます。空白の区間が休符です。':'空白をクリックすると、その行の音程比で音符が追加されます。空白の区間が休符です。';}
  }
  function selectNote(laneId,noteId){selected={laneId,noteId};
    document.querySelectorAll('.note-block').forEach(el=>el.classList.toggle('selected',el.dataset.noteId===noteId));
    renderInspector();
  }
  function deleteSelected(){const s=getSelected();if(!s)return;s.lane.notes=s.lane.notes.filter(n=>n.id!==s.note.id);selected=null;renderRoll();sequenceStatus('選択した音符を削除しました。');}
  $('deleteNote').addEventListener('click',deleteSelected);
  document.addEventListener('keydown',e=>{
    if((e.key==='Delete'||e.key==='Backspace')&&getSelected()&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {e.preventDefault();deleteSelected();}
  });
  for(const [element,key] of [['noteStart','start'],['noteDuration','duration'],['noteVolume','volume']]){
    $(element).addEventListener('change',e=>{
      const s=getSelected();if(!s)return;
      let v;
      try { v=key==='volume'?Number(e.target.value):parseBeat(e.target.value); }
      catch(err) { sequenceStatus(err.message,'err');renderInspector();return; }
      const end=totalBeats();
      if(!Number.isFinite(v)|| (key==='volume'?(v<0||v>100):key==='start'?(v<0||v+s.note.duration>end+1e-8):(v<=0||s.note.start+v>end+1e-8))){
        sequenceStatus('開始位置は0以上、音符の長さは0より大きく、曲の終わりを超えないようにしてください。','err');renderInspector();return;
      }
      s.note[key]=key==='volume'?Math.round(v):v;renderRoll();
    });
  }
  function renderRoll(){
    const container=$('rollContent'),scroll=$('scrollTimeline'),keepX=scroll.scrollLeft,keepY=scroll.scrollTop;
    const total=totalBeats(),width=total*beatPx,barWidth=beatsPerBar*beatPx;
    container.innerHTML='';container.style.width=(LABEL_WIDTH+width)+'px';
    const ruler=document.createElement('div');ruler.className='ruler-row';
    const corner=document.createElement('div');corner.className='corner';corner.innerHTML=rollMode==='tet'?'<span>鍵盤 / 12平均律</span><small>音量%</small>':'<span>音程比（自由入力）</span><small>音量%</small>';
    const rulerTrack=document.createElement('div');rulerTrack.className='ruler-track';rulerTrack.style.width=width+'px';
    for(let bar=0;bar<bars;bar++){
      const label=document.createElement('div');label.className='bar-label';label.style.left=bar*barWidth+'px';label.style.width=barWidth+'px';label.textContent=`${bar+1} 小節`;rulerTrack.append(label);
    }
    for(let beat=1;beat<total;beat++)if(beat%beatsPerBar){const tick=document.createElement('div');tick.className='beat-tick';tick.style.left=(beat*beatPx)+'px';rulerTrack.append(tick);}
    // Draw subdivision marks: 1/3 beat for eighth-note triplets, etc.
    if(snap<1){
      for(let i=1, ticks=Math.ceil(total/snap);i<ticks;i++){
        const beat=i*snap;
        if(beat>=total-1e-8||Math.abs(beat-Math.round(beat))<1e-8)continue;
        const mark=document.createElement('div');mark.className='subdivision-tick';
        if(isTripletGrid())mark.classList.add('triplet-tick');
        mark.style.left=(beat*beatPx)+'px';rulerTrack.append(mark);
      }
    }
    ruler.append(corner,rulerTrack);container.append(ruler);
    lanes.forEach((lane,laneIndex)=>{
      const row=document.createElement('div');row.className='note-row';
      const info=document.createElement('div');info.className='lane-info';
      const hz=document.createElement('span');hz.className='lane-hz';
      if(rollMode==='tet'){
        row.classList.add('tet-row');
        if(isBlackKey(lane.midi))row.classList.add('tet-black-row');
        if(lane.midi%12===0)row.classList.add('tet-c-row');
        const key=document.createElement('button');key.type='button';
        key.className='piano-key '+(isBlackKey(lane.midi)?'black-key':'white-key');
        key.textContent=noteName(lane.midi);
        key.title=`${noteName(lane.midi)}${alternateName(lane.midi)?' / '+alternateName(lane.midi):''} · MIDI ${lane.midi} · クリックで試聴`;
        key.setAttribute('aria-label',`${noteName(lane.midi)}を試聴`);
        key.addEventListener('click',async()=>{try{await previewLane(lane);}catch(e){sequenceStatus(e.message,'err');}});
        hz.textContent=fixedHz(laneFrequency(lane))+' Hz';
        info.append(key,hz);
      }else{
        const index=document.createElement('span');index.className='lane-index';index.textContent=String(laneIndex+1).padStart(2,'0');
        const ratio=document.createElement('input');ratio.className='lane-ratio';ratio.value=lane.ratio;ratio.title='周波数比。例：3/2、23/16';ratio.setAttribute('aria-label',`第${laneIndex+1}音の周波数比`);
        ratio.addEventListener('change',()=>{
          try{const val=parseRatio(ratio.value);if(baseHz*val<20||baseHz*val>=22050)throw Error('指定比率で発生する周波数が範囲外です。');lane.ratio=ratio.value.trim();lane.name='';renderRoll();}
          catch(e){ratio.value=lane.ratio;sequenceStatus(e.message,'err');}
        });
        try{hz.textContent=fixedHz(laneFrequency(lane))+' Hz';}catch(e){hz.textContent='無効';info.classList.add('bad-ratio');}
        info.append(index,ratio,hz);
      }
      const vol=document.createElement('input');vol.className='lane-vol';vol.type='number';vol.min='0';vol.max='100';vol.step='1';vol.value=lane.volume;vol.title='この音の音量（%）';vol.setAttribute('aria-label',`${laneName(lane)} の音量`);
      vol.addEventListener('change',()=>{const v=Number(vol.value);if(!Number.isInteger(v)||v<0||v>100){vol.value=lane.volume;sequenceStatus('音量は0〜100%で指定してください。','err');return;}lane.volume=v;});
      const hear=document.createElement('button');hear.className='lane-play';hear.type='button';hear.textContent='▶';hear.title='この音を試聴';hear.addEventListener('click',async()=>{try{await previewLane(lane);}catch(e){sequenceStatus(e.message,'err');}});
      if(rollMode==='tet'){
        // Notes are fixed to the exact 12-TET MIDI pitches; the keyboard is not editable.
        info.append(vol,hear);
      }else{
        const del=document.createElement('button');del.className='lane-delete';del.type='button';del.textContent='×';del.title='この音程行を削除';del.setAttribute('aria-label',`第${laneIndex+1}音を削除`);
        del.addEventListener('click',()=>{
          if(lanes.length<=1){sequenceStatus('最後の1音は削除できません。','warn');return;}
          if(lane.notes.length&&!confirm('この音程行にある音符も削除します。続けますか？'))return;
          lanes=lanes.filter(l=>l.id!==lane.id);if(selected?.laneId===lane.id)selected=null;renderRoll();
        });
        info.append(vol,hear,del);
      }
      const track=document.createElement('div');track.className='lane-track';track.style.width=width+'px';
      track.style.backgroundImage='linear-gradient(to right, #455770 1px, transparent 1px), linear-gradient(to right, #354962 1px, transparent 1px), linear-gradient(to right, #29445688 1px, transparent 1px)';
      track.style.backgroundSize=`${barWidth}px 100%, ${beatPx}px 100%, ${snap*beatPx}px 100%`;
      track.setAttribute('aria-label',`${laneName(lane)} のタイムライン。空白をクリックして音符を配置`);
      track.addEventListener('click',ev=>{
        if(ev.target.closest('.note-block'))return;
        if(allNotes()>=MAX_NOTES){sequenceStatus('音符は最大512個です。','warn');return;}
        const x=ev.clientX-track.getBoundingClientRect().left;
        const start=clamp(Math.floor((x/beatPx+1e-8)/snap)*snap,0,Math.max(0,total-snap));
        const duration=Math.min(newNoteDuration(),total-start),note=newNote(start,duration);
        lane.notes.push(note);selected={laneId:lane.id,noteId:note.id};renderRoll();
        sequenceStatus(`音符を追加：${laneName(lane)}、開始 ${beatString(start)}拍、長さ ${beatString(duration)}拍（${currentGridText()}）。`);
      });
      lane.notes.forEach(note=>{
        const el=document.createElement('div');el.className='note-block';el.tabIndex=0;el.setAttribute('role','button');el.dataset.noteId=note.id;
        const w=note.duration*beatPx;el.style.left=(note.start*beatPx+1)+'px';el.style.width=Math.max(7,w-2)+'px';
        if(w<36)el.classList.add('too-small');if(w<18)el.classList.add('tiny-note');if(selected?.noteId===note.id)el.classList.add('selected');
        const text=document.createElement('span');text.className='note-text';text.textContent=laneName(lane);
        const handle=document.createElement('span');handle.className='resize-handle';handle.title='音符の長さを変更';
        el.append(text,handle);
        el.addEventListener('click',e=>{e.stopPropagation();selectNote(lane.id,note.id);});
        el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNote(lane.id,note.id);}});
        el.addEventListener('pointerdown',e=>{
          if(e.button!==0)return;
          e.preventDefault();e.stopPropagation();
          selectNote(lane.id,note.id);
          const resize=e.target===handle||(el.clientWidth>18 && e.offsetX>el.clientWidth-13);
          const origin=e.clientX,initialStart=note.start,initialDuration=note.duration;
          let moved=false;
          el.setPointerCapture(e.pointerId);
          const moving=ev=>{
            if(!el.hasPointerCapture(ev.pointerId))return;
            const delta=snapTo((ev.clientX-origin)/beatPx);
            if(Math.abs(ev.clientX-origin)>3)moved=true;
            if(!moved)return;
            if(resize){note.duration=clamp(snapTo(initialDuration+delta),snap,totalBeats()-note.start);el.style.width=Math.max(7,note.duration*beatPx-2)+'px';}
            else{note.start=clamp(snapTo(initialStart+delta),0,totalBeats()-note.duration);el.style.left=(note.start*beatPx+1)+'px';}
            renderInspector();
          };
          const done=ev=>{
            el.removeEventListener('pointermove',moving);el.removeEventListener('pointerup',done);el.removeEventListener('pointercancel',done);
            try{if(el.hasPointerCapture(ev.pointerId))el.releasePointerCapture(ev.pointerId);}catch(_e){}
            renderRoll();
          };
          el.addEventListener('pointermove',moving);el.addEventListener('pointerup',done);el.addEventListener('pointercancel',done);
        });
        track.append(el);
      });
      row.append(info,track);container.append(row);
    });
    const head=document.createElement('div');head.id='playhead';head.className='playhead';container.append(head);
    $('trackCount').textContent=rollMode==='tet'?`12平均律 · ${lanes.length}鍵`:`${lanes.length} / ${MAX_LANES} 音`;
    $('measureText').textContent=`${bars}小節 · ${total}拍 · ${allNotes()}音符`;
    $('addLane').disabled=rollMode==='tet'||lanes.length>=MAX_LANES;
    $('addLane').hidden=rollMode==='tet';
    scroll.scrollLeft=keepX;scroll.scrollTop=keepY;
    renderInspector();updateNavigator();if(playing)updatePlayhead();
  }
  function syncRollModeUi(){
    const ratio=rollMode==='ratio';
    $('ratioModeButton').setAttribute('aria-selected',String(ratio));
    $('equalModeButton').setAttribute('aria-selected',String(!ratio));
    $('ratioModeButton').classList.toggle('active',ratio);
    $('equalModeButton').classList.toggle('active',!ratio);
    $('rollTitle').innerHTML=ratio?'比率ピアノロール <span class="minor">/ 最大40音程行</span>':'12平均律ピアノロール <span class="minor">/ C2〜B6・60鍵</span>';
    $('tetTuningField').hidden=ratio;
    $('rollGuideRatio').hidden=!ratio;
    $('rollGuideTet').hidden=ratio;
    $('rollPitchInfo').textContent=ratio?'基準周波数 × 入力した比率。音程は12平均律に丸めません。':'12平均律の音高＝A4基準Hz × 2^((MIDI番号−69)/12)。ピアノ鍵盤をクリックして試聴できます。';
    $('resetScore').textContent=ratio?'禮司の初期データに戻す':'12平均律の音符をすべて消去';
  }
  function switchRollMode(next){
    if(next===rollMode)return;
    if(playing)stopSequence(false);
    if(rollMode==='ratio')ratioLanes=lanes;else tetLanes=lanes;
    rollMode=next;
    lanes=rollMode==='ratio'?ratioLanes:tetLanes;
    selected=null;
    syncRollModeUi();renderRoll();
    if(rollMode==='tet'&&tetFirstVisit){
      const centerRow=TET_MAX_MIDI-60; // C4 approximately centered on first visit
      $('scrollTimeline').scrollTop=Math.max(0,43+centerRow*52-260);
      tetFirstVisit=false;
    }
    sequenceStatus(rollMode==='tet'
      ?'12平均律ピアノロールに切り替えました。C2〜B6の60鍵。比率ピアノロールの音符は保存されたままです。'
      :'比率ピアノロールに戻りました。純正比率の音符・位置・長さは変更していません。');
  }
  $('ratioModeButton').addEventListener('click',()=>switchRollMode('ratio'));
  $('equalModeButton').addEventListener('click',()=>switchRollMode('tet'));
  $('a4Hz').addEventListener('change',e=>{
    const val=Number(e.target.value);
    if(!Number.isFinite(val)||val<400||val>480){e.target.value=String(a4Hz);sequenceStatus('A4基準は400〜480 Hzで入力してください。','err');return;}
    a4Hz=val;if(playing)stopSequence(false);renderRoll();
    sequenceStatus(`12平均律の基準を A4 = ${a4Hz} Hz に設定しました。`);
  });
  function updateNavigator(){
    const sc=$('scrollTimeline'),max=sc.scrollWidth-sc.clientWidth;
    $('horizontalNav').value=max>0?Math.round(sc.scrollLeft/max*1000):0;
    $('horizontalNav').disabled=max<=0;
    $('navPosition').textContent=max?Math.round(sc.scrollLeft/max*100)+'%':'全体表示';
  }
  $('scrollTimeline').addEventListener('scroll',updateNavigator,{passive:true});
  $('horizontalNav').addEventListener('input',e=>{const sc=$('scrollTimeline');sc.scrollLeft=(sc.scrollWidth-sc.clientWidth)*Number(e.target.value)/1000;});
  $('addLane').addEventListener('click',()=>{if(rollMode!=='ratio'||lanes.length>=MAX_LANES)return;lanes.push(newLane());renderRoll();const sc=$('scrollTimeline');sc.scrollTop=sc.scrollHeight;sequenceStatus(`音程行を追加しました（${lanes.length}/${MAX_LANES}）。左側の1/1を編集してください。`);});
  $('tempo').addEventListener('change',e=>{const v=Number(e.target.value);if(!Number.isInteger(v)||v<20||v>300){e.target.value=tempo;sequenceStatus('テンポは20〜300 BPMで指定してください。','err');return;}tempo=v;});
  $('meter').addEventListener('change',e=>{
    const nextBeatsPerBar=Number(e.target.value);
    if(![2,3,4,6].includes(nextBeatsPerBar)){
      e.target.value=beatsPerBar;
      sequenceStatus('対応していない拍子です。','err');
      return;
    }
    // Keep note positions and durations unchanged when regrouping measures.
    // Extend the bar count if the new meter would otherwise cut off notes.
    const lastNoteEnd=[currentRatioLanes(),currentTetLanes()].reduce((prev,list)=>
      list.reduce((max,lane)=>lane.notes.reduce((end,note)=>Math.max(end,note.start+note.duration),max),prev),0);
    const requiredBars=Math.max(1,Math.ceil((lastNoteEnd-1e-7)/nextBeatsPerBar));
    const previousBars=bars;
    const nextBars=Math.max(bars,requiredBars);
    if(nextBars>64){
      e.target.value=beatsPerBar;
      sequenceStatus('この拍子では64小節を超えるため変更できません。音符を減らすか小節を調整してください。','warn');
      return;
    }
    if(playing)stopSequence(false);
    beatsPerBar=nextBeatsPerBar;
    bars=nextBars;
    $('bars').value=bars;
    renderRoll();
    const expanded=bars>previousBars?`音符を残すため小節数を${previousBars}→${bars}に自動調整しました。`:'音符の位置と長さは維持されます。';
    sequenceStatus(`拍子を${beatsPerBar}/4に変更しました。${bars}小節・${totalBeats()}拍。${expanded}`);
  });
  $('bars').addEventListener('change',e=>{
    const b=Number(e.target.value);
    if(!Number.isInteger(b)||b<1||b>64||[currentRatioLanes(),currentTetLanes()].some(list=>list.some(l=>l.notes.some(n=>n.start+n.duration>b*beatsPerBar+1e-6)))){e.target.value=bars;sequenceStatus('小節数は1〜64。配置済みの音符を切り捨てる変更はできません。','warn');return;}
    bars=b;renderRoll();
  });
  $('snap').addEventListener('change',e=>{
    snap=Number(e.target.value);
    if(!(snap>0)) {snap=.25;e.target.value=String(snap);}
    renderRoll();
    sequenceStatus(`グリッド：${currentGridText()}。3連符のグリッドでは空白クリックで1個分の3連音符を追加します。`);
  });
  $('zoom').addEventListener('input',e=>{beatPx=Number(e.target.value);$('zoomLabel').textContent=beatPx+'px/拍';renderRoll();});
  $('sequencePlay').addEventListener('click',async()=>{const b=$('sequencePlay');b.disabled=true;try{await startSequence();}catch(e){announceError(e);}finally{b.disabled=false;}});
  $('sequenceStop').addEventListener('click',()=>stopSequence());
  function syncSongSettings() {
    $('tempo').value=tempo;
    $('meter').value=beatsPerBar;
    $('bars').value=bars;
    $('snap').value=String(snap);
    $('zoom').value=beatPx;
    $('zoomLabel').textContent=beatPx+'px/拍';
    $('baseHz').value=baseHz;
    $('master').value=master;
    $('masterValue').textContent=master+'%';
    $('preset').value='custom';
  }
  $('resetScore').addEventListener('click',()=>{
    if(rollMode==='tet'){
      if(!confirm('12平均律ピアノロールの音符をすべて消去します。比率ピアノロールは変更されません。よろしいですか？'))return;
      if(playing)stopSequence(false);tetLanes=makeTetLanes();lanes=tetLanes;selected=null;renderRoll();
      sequenceStatus('12平均律の音符をすべて消去しました。比率ピアノロールはそのままです。');return;
    }
    if(playing)stopSequence(false);
    const hasTetNotes=tetLanes.some(l=>l.notes.length>0);
    baseHz=DEFAULT_SONG.baseHz;master=DEFAULT_SONG.master;
    if(!hasTetNotes){
      // Safe to restore shared timeline when the equal-temperament roll is empty.
      tempo=DEFAULT_SONG.tempo;beatsPerBar=DEFAULT_SONG.beatsPerBar;
      bars=DEFAULT_SONG.bars;snap=DEFAULT_SONG.snap;
    }else{
      // Do not silently clip notes belonging to the other piano roll.
      bars=Math.max(bars,Math.ceil((DEFAULT_SONG.bars*DEFAULT_SONG.beatsPerBar-1e-7)/beatsPerBar));
    }
    beatPx=54;ratioLanes=makeDefaultLanes();lanes=ratioLanes;partials=DEFAULT_SONG.partials.map(p=>({...p}));selected=null;
    syncSongSettings();
    $('scrollTimeline').scrollLeft=0;$('scrollTimeline').scrollTop=0;
    soundSource='synth';$('soundSource').value='synth';sampleReferenceHz=DEFAULT_SONG.baseHz;$('sampleReferenceHz').value=sampleReferenceHz;syncPower();
    refreshAudio();renderMixer();renderRoll();drawVisuals();
    sequenceStatus(hasTetNotes
      ?'禮司の英国国歌・音色を復元しました。12平均律の音符を保護するため、共有のテンポ・拍子・小節数・グリッドは維持しています。'
      :'禮司の初期データを復元しました：英国国歌（純正比率）、3/4拍子・14小節。音符とミキシング設定も復元しています。');
  });
  function validTimbre(data){
    if(!Array.isArray(data)||data.length!==MAX_PARTIALS)throw Error('24倍音のデータが不正です。');
    return data.map(p=>{if(!p||!Number.isFinite(p.level)||p.level<0||p.level>100||!waves.some(x=>x[0]===p.wave)||typeof p.muted!=='boolean')throw Error('倍音データに不正な値があります。');return {level:p.level,wave:p.wave,muted:p.muted};});
  }
  function exportFile(name,value){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('saveSong').addEventListener('click',()=>exportFile('reiji-lab-piano-roll-song.json',{
    format:'reiji-lab-ratio-piano-roll',version:2,baseHz,master,tempo,beatsPerBar,bars,snap,
    activeRoll:rollMode,a4Hz,
    sampler:{mode:soundSource,referenceHz:sampleReferenceHz,filename:sampleFilename},
    // Keep the legacy ratio lanes at the original root for compatibility.
    lanes:savedLanes(currentRatioLanes()),
    pianoRolls:{ratio:savedLanes(currentRatioLanes()),tet:savedLanes(currentTetLanes())},
    partials
  }));
  // Full mixer export: independent from the score, including all gains and
  // partial waveform choices. Note positions and tuning ratios are metadata only
  // so that a mix cannot silently change another score's notes.
  $('saveMix').addEventListener('click',()=>{
    exportFile(rollMode==='tet'?'reiji-lab-12tet-mixing.json':'reiji-lab-ratio-roll-mixing.json',{
      format:'reiji-lab-ratio-roll-mixing',version:1,
      baseHz,master,mode:rollMode,a4Hz,
      lanes:savedLanes(lanes),
      partials:partials.map(p=>({...p}))
    });
    sequenceStatus('曲全体のミキシング設定をダウンロードしました（音程比・音符のタイミングは変更されません）。');
  });
  $('loadMix').addEventListener('click',()=>$('mixFile').click());
  $('mixFile').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      if(f.size>3e5)throw Error('ファイルが大きすぎます。');
      const d=JSON.parse(await f.text());
      if(d.format!=='reiji-lab-ratio-roll-mixing'||d.version!==1)
        throw Error('このアプリのミキシング設定JSONではありません。');
      if((d.mode||'ratio')!==rollMode)throw Error('ミキシング設定のピアノロール方式が異なります。対応する方式に切り替えてください。');
      if(!Array.isArray(d.lanes)||d.lanes.length!==lanes.length)
        throw Error('音程行の数が異なります。曲を読み込んでからミキシング設定を適用してください。');
      if(!Number.isFinite(d.master)||d.master<0||d.master>100)
        throw Error('マスター音量が不正です。');
      const timbre=validTimbre(d.partials);
      const levels=d.lanes.map((l,i)=>{
        const source=lanes[i];
        if(!l||(rollMode==='tet'?l.midi!==source.midi:l.ratio!==source.ratio)||!Array.isArray(l.notes)||l.notes.length!==source.notes.length)
          throw Error('音程比または音符の数が異なります。同じ曲のミキシング情報を使ってください。');
        if(!Number.isFinite(l.volume)||l.volume<0||l.volume>100)
          throw Error('音程行の音量が不正です。');
        const noteLevels=l.notes.map((n,j)=>{
          const original=source.notes[j];
          if(!n||!Number.isFinite(n.start)||!Number.isFinite(n.duration)||
            Math.abs(n.start-original.start)>1e-7||Math.abs(n.duration-original.duration)>1e-7)
            throw Error('音符の発音位置や音価が異なります。元の曲に適用してください。');
          if(!Number.isFinite(n.volume)||n.volume<0||n.volume>100)
            throw Error('音符の音量が不正です。');
          return n.volume;
        });
        return {volume:l.volume,noteLevels};
      });
      if(playing)stopSequence(false);
      master=d.master;partials=timbre;
      levels.forEach((v,i)=>{lanes[i].volume=v.volume;
        v.noteLevels.forEach((level,j)=>{lanes[i].notes[j].volume=level;});});
      $('master').value=master;$('masterValue').textContent=master+'%';
      $('preset').value='custom';refreshAudio();renderMixer();renderRoll();drawVisuals();
      sequenceStatus('ミキシング設定を読み込みました。音高と発音位置は変更していません。');
    }catch(err){announceError(err);}finally{e.target.value='';}
  });
  $('loadSong').addEventListener('click',()=>$('songFile').click());
  $('songFile').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      if(f.size>3e5)throw Error('ファイルが大きすぎます。');
      const d=JSON.parse(await f.text());
      if(d.format!=='reiji-lab-ratio-piano-roll'||!Array.isArray(d.lanes)||d.lanes.length<1||d.lanes.length>MAX_LANES)throw Error('このアプリの曲データではありません。');
      if(![2,3,4,6].includes(d.beatsPerBar)||!Number.isInteger(d.bars)||d.bars<1||d.bars>64||!Number.isFinite(d.tempo)||d.tempo<20||d.tempo>300||!Number.isFinite(d.baseHz)||d.baseHz<20||d.baseHz>2000||!Number.isFinite(d.master)||d.master<0||d.master>100)throw Error('曲の基本設定が不正です。');
      let count=0;
      const cleanRatio=data=>{
        if(!Array.isArray(data)||!data.length||data.length>MAX_LANES)throw Error('比率ピアノロールの行数が不正です。');
        return data.map(l=>{
          if(!l||typeof l.ratio!=='string'||!Array.isArray(l.notes)||!Number.isFinite(l.volume)||l.volume<0||l.volume>100)throw Error('音程行の値が不正です。');
          const r=parseRatio(l.ratio);if(d.baseHz*r<20||d.baseHz*r>=22050)throw Error('周波数比が再生可能範囲外です。');
          return {id:id('lane-'),name:typeof l.name==='string'?l.name.slice(0,30):'',ratio:l.ratio,volume:l.volume,notes:cleanNotes(l.notes)};
        });
      };
      const cleanNotes=notes=>notes.map(n=>{
        if(!n||!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.duration)||n.duration<=0||n.start+n.duration>d.bars*d.beatsPerBar+1e-6||!Number.isFinite(n.volume)||n.volume<0||n.volume>100)throw Error('音符の値が不正です。');
        count++;return newNote(n.start,n.duration,n.volume);
      });
      const cleanTet=data=>{
        if(!Array.isArray(data)||data.length!==TET_MAX_MIDI-TET_MIN_MIDI+1)throw Error('12平均律ピアノロールには60鍵が必要です。');
        const midiSeen=new Set();
        const list=data.map(l=>{
          if(!l||!Number.isInteger(l.midi)||l.midi<TET_MIN_MIDI||l.midi>TET_MAX_MIDI||midiSeen.has(l.midi)||!Array.isArray(l.notes)||!Number.isFinite(l.volume)||l.volume<0||l.volume>100)throw Error('12平均律ピアノロールの鍵盤データが不正です。');
          midiSeen.add(l.midi);
          return {id:id('lane-'),name:noteName(l.midi),midi:l.midi,volume:l.volume,notes:cleanNotes(l.notes)};
        });
        list.sort((a,b)=>b.midi-a.midi);
        return list;
      };
      const importedRatio=cleanRatio(d.pianoRolls?.ratio||d.lanes);
      const importedTet=d.pianoRolls?.tet?cleanTet(d.pianoRolls.tet):makeTetLanes();
      if(count>MAX_NOTES*2)throw Error('各ピアノロールの音符は512個以内です。');
      if(importedRatio.reduce((sum,l)=>sum+l.notes.length,0)>MAX_NOTES || importedTet.reduce((sum,l)=>sum+l.notes.length,0)>MAX_NOTES)throw Error('各ピアノロールの音符は512個以内です。');
      const importedA4=Number.isFinite(d.a4Hz)?d.a4Hz:440;
      if(importedA4<400||importedA4>480)throw Error('A4基準は400〜480 Hzで指定してください。');
      const importedPartials=d.partials?validTimbre(d.partials):partials;
      if(playing)stopSequence(false);
      ratioLanes=importedRatio;tetLanes=importedTet;
      rollMode=d.activeRoll==='tet'&&d.pianoRolls?.tet?'tet':'ratio';
      lanes=rollMode==='tet'?tetLanes:ratioLanes;
      a4Hz=importedA4;tetFirstVisit=rollMode!=='tet';
      partials=importedPartials;tempo=d.tempo;beatsPerBar=d.beatsPerBar;bars=d.bars;baseHz=d.baseHz;master=d.master;selected=null;
      $('a4Hz').value=String(a4Hz);
      syncRollModeUi();
      // Old saves do not have snap; keep the old default in that case.
      snap=[1,.5,.25,2/3,1/3,1/6].find(v=>Math.abs((d.snap??.25)-v)<1e-10)??.25;
      $('snap').value=String(snap);
      if(d.sampler && Number.isFinite(d.sampler.referenceHz) && d.sampler.referenceHz>=20 && d.sampler.referenceHz<=5000){
        sampleReferenceHz=d.sampler.referenceHz;
        $('sampleReferenceHz').value=sampleReferenceHz;
      }
      soundSource=d.sampler?.mode==='sample'?'sample':'synth';
      $('soundSource').value=soundSource;
      updateSamplerUi();syncPower();
      $('tempo').value=tempo;$('meter').value=beatsPerBar;$('bars').value=bars;$('baseHz').value=baseHz;$('master').value=master;$('masterValue').textContent=master+'%';$('preset').value='custom';
      refreshAudio();renderMixer();renderRoll();drawVisuals();
      sequenceStatus(`読み込み完了：${rollMode==='tet'?'12平均律':'比率'} ${lanes.length}音程行、合計${count}音符。${soundSource==='sample'&&!sampleBuffer?' 音声はJSONに含まれません。WAVファイルを別途読み込んでください。':''}`);
    }catch(err){announceError(err);}finally{e.target.value='';}
  });
  $('saveTimbre').addEventListener('click',()=>exportFile('reiji-lab-harmonics-24.json',{format:'reiji-lab-harmonic-synth-24',version:1,baseHz,master,partials}));
  $('loadTimbre').addEventListener('click',()=>$('timbreFile').click());
  $('timbreFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;
    try{const d=JSON.parse(await f.text());if(d.format!=='reiji-lab-harmonic-synth-24')throw Error('24倍音の音色データではありません。');partials=validTimbre(d.partials);$('preset').value='custom';renderMixer();refreshAudio();drawVisuals();status('24倍音の設定を読み込みました。');}
    catch(err){status(err.message,'err');}finally{e.target.value='';}
  });
  function updatePlayhead(){
    const ph=$('playhead');if(!ph||!ctx)return;
    if(!playing){ph.style.display='none';return;}
    const beat=clamp((ctx.currentTime-sequenceStart)*tempo/60,0,totalBeats());
    ph.style.display='block';ph.style.left=(LABEL_WIDTH+beat*beatPx)+'px';
    const scroll=$('scrollTimeline'),x=LABEL_WIDTH+beat*beatPx;
    if(x-scroll.scrollLeft>scroll.clientWidth-60 || x-scroll.scrollLeft<LABEL_WIDTH+20){scroll.scrollLeft=clamp(x-LABEL_WIDTH-80,0,scroll.scrollWidth-scroll.clientWidth);}
  }
  function samplerStatus(message,kind=''){
    $('samplerStatus').textContent=message;
    $('samplerStatus').className='sample-status '+kind;
  }
  function updateSamplerUi(){
    $('sampleBadge').textContent=sampleBuffer?`${sampleBuffer.duration.toFixed(2)}秒 / ${sampleFilename||'マイク録音'}`:'音源未登録';
    $('samplePreview').disabled=!sampleBuffer;
    $('sampleSaveWav').disabled=!sampleBuffer;
    $('soundSource').value=soundSource;
    syncPower();drawSampleWave();
  }
  async function playSamplePreview(){
    if(!sampleBuffer)throw Error('録音した音か音声ファイルを用意してください。');
    await setupAudio();
    if(playing)stopSequence(false);
    if(audition){audition=false;refreshAudio();}
    const bus=ctx.createGain();bus.connect(masterGain);
    const at=ctx.currentTime+.03,duration=Math.min(2.2,Math.max(.5,sampleBuffer.duration));
    const note=scheduleSampleNote(bus,at,duration,baseHz,.75,.7,samplePreviewNodes);
    note.osc.onended=()=>{try{note.osc.disconnect();note.env.disconnect();bus.disconnect();}catch(_e){}samplePreviewNodes.delete(note);};
    animate();syncPower();
    samplerStatus(`試聴中：サンプル基準 ${sampleReferenceHz.toFixed(2)} Hz → 出力 ${baseHz.toFixed(2)} Hz。`);
  }
  function endMicStream(){
    if(micTimer){clearTimeout(micTimer);micTimer=null;}
    if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
  }
  async function stopMicRecording(){
    if(micRecorder&&micRecorder.state==='recording')micRecorder.stop();
    $('sampleRecordStart').disabled=false;$('sampleRecordStop').disabled=true;
    endMicStream();
  }
  async function installAudioSample(buffer,filename){
    // Convert to mono and trim silence, keeping only at most ten seconds.
    if(!buffer?.length||!buffer.numberOfChannels)throw Error('音声データが空です。');
    const fs=buffer.sampleRate,len=Math.min(buffer.length,Math.round(fs*10));
    const input=new Float32Array(len),count=Math.min(buffer.numberOfChannels,2);
    for(let c=0;c<count;c++){
      const channel=buffer.getChannelData(c);
      for(let j=0;j<len;j++)input[j]+=channel[j]/count;
    }
    let peak=0;for(let j=0;j<len;j++)peak=Math.max(peak,Math.abs(input[j]));
    if(peak<.004)throw Error('録音音量が小さすぎます。マイクを近づけて再録音してください。');
    const threshold=Math.max(.003,peak*.015);
    let first=0,last=len-1;
    while(first<len&&Math.abs(input[first])<threshold)first++;
    while(last>first&&Math.abs(input[last])<threshold)last--;
    first=Math.max(0,first-Math.round(fs*.02));
    last=Math.min(len-1,last+Math.round(fs*.10));
    const length=last-first+1;
    if(length<fs*.08)throw Error('録音された音が短すぎます。0.1秒以上の単音を録音してください。');
    const out=ctx.createBuffer(1,length,fs),arr=out.getChannelData(0);
    const fade=Math.max(1,Math.min(Math.round(fs*.01),Math.floor(length*.05)));
    for(let i=0;i<length;i++){
      const edge=Math.min(1,i/fade,(length-1-i)/fade);
      arr[i]=Math.max(-1,Math.min(1,input[first+i]*.85/peak))*edge;
    }
    sampleBuffer=out;sampleFilename=filename;
    soundSource='sample';
    if(playing)stopSequence(false);
    if(audition){audition=false;refreshAudio();}
    updateSamplerUi();
    samplerStatus(`音源を登録しました：${sampleFilename} / ${out.duration.toFixed(2)}秒。基準周波数を合わせてピアノロールを再生してください。`);
  }
  async function decodeAudioData(arrayBuffer){
    await setupAudio();
    try{return await ctx.decodeAudioData(arrayBuffer);}
    catch(_e){throw Error('音声をデコードできません。WAVなどブラウザが対応する形式をお試しください。');}
  }
  $('soundSource').addEventListener('change',e=>{
    soundSource=e.target.value==='sample'?'sample':'synth';
    if(playing)stopSequence(false);
    if(audition){audition=false;refreshAudio();}
    updateSamplerUi();
    if(soundSource==='sample'&&!sampleBuffer)samplerStatus('録音ボタンを押すか、既存の音声ファイルを読み込んでください。','err');
    else samplerStatus(soundSource==='sample'?`サンプリング音源を使用します（${sampleFilename}）。`:'24倍音ミキサーの合成音を使用します。');
  });
  $('sampleReferenceHz').addEventListener('change',e=>{
    const hz=Number(e.target.value);
    if(!Number.isFinite(hz)||hz<20||hz>5000){e.target.value=sampleReferenceHz;samplerStatus('基準周波数は20〜5000 Hzにしてください。','err');return;}
    sampleReferenceHz=hz;
    samplerStatus(`サンプル基準周波数を${hz} Hzに変更しました。録音音の実際の音高に合わせてください。`);
  });
  $('sampleRecordStart').addEventListener('click',async()=>{
    const button=$('sampleRecordStart');button.disabled=true;
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)
        throw Error('このブラウザまたは接続方法では録音できません。HTTPSで公開してChrome / Edgeをお試しください。');
      if(playing)stopSequence(false);
      if(audition){audition=false;refreshAudio();syncPower();}
      micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      micRecorder=new MediaRecorder(micStream,mime?{mimeType:mime}:undefined);
      micChunks=[];
      micRecorder.addEventListener('dataavailable',e=>{if(e.data?.size)micChunks.push(e.data);});
      micRecorder.addEventListener('stop',async()=>{
        endMicStream();
        try{
          if(!micChunks.length)throw Error('録音データが取得できませんでした。');
          const blob=new Blob(micChunks,{type:micRecorder.mimeType||'audio/webm'});
          const decoded=await decodeAudioData(await blob.arrayBuffer());
          await installAudioSample(decoded,'microphone-sample.wav');
        }catch(err){samplerStatus(err.message,'err');}
        finally{micChunks=[];micRecorder=null;}
      },{once:true});
      micRecorder.start();
      $('sampleRecordStop').disabled=false;
      samplerStatus('● 録音中です。できるだけ単音を鳴らし、録音終了を押してください（最大10秒）。','recording');
      micTimer=setTimeout(()=>stopMicRecording(),10000);
    }catch(err){endMicStream();button.disabled=false;$('sampleRecordStop').disabled=true;samplerStatus(err.message,'err');}
  });
  $('sampleRecordStop').addEventListener('click',stopMicRecording);
  $('samplePreview').addEventListener('click',async()=>{try{await playSamplePreview();}catch(err){samplerStatus(err.message,'err');}});
  $('sampleFileOpen').addEventListener('click',()=>$('sampleFile').click());
  $('sampleFile').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      if(f.size>24e6)throw Error('音声ファイルは24MB以下にしてください。');
      const decoded=await decodeAudioData(await f.arrayBuffer());
      await installAudioSample(decoded,f.name);
    }catch(err){samplerStatus(err.message,'err');}
    finally{e.target.value='';}
  });
  function sampleToWav(buf){
    const samples=buf.getChannelData(0),size=44+samples.length*2;
    const out=new ArrayBuffer(size),view=new DataView(out),fs=buf.sampleRate;
    const write=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    write(0,'RIFF');view.setUint32(4,size-8,true);write(8,'WAVE');write(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,fs,true);view.setUint32(28,fs*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);
    write(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++){
      const v=Math.max(-1,Math.min(1,samples[i]));
      view.setInt16(44+i*2,v<0?v*32768:v*32767,true);
    }
    return new Blob([out],{type:'audio/wav'});
  }
  $('sampleSaveWav').addEventListener('click',()=>{
    if(!sampleBuffer)return;
    const blob=sampleToWav(sampleBuffer),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='reiji-lab-sampled-instrument.wav';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    samplerStatus('録音音源をWAVで保存しました。曲JSONとWAVをセットで保管してください。');
  });
  function drawSampleWave(){
    const canvas=$('sampleWaveCanvas');if(!canvas)return;
    const {c,w,h}=fitCanvas(canvas);c.clearRect(0,0,w,h);
    const mid=h/2;c.strokeStyle='#314d60';c.beginPath();c.moveTo(0,mid);c.lineTo(w,mid);c.stroke();
    if(!sampleBuffer){c.fillStyle='#8292aa';c.font='12px system-ui';c.fillText('No sample loaded',12,mid-10);return;}
    const samples=sampleBuffer.getChannelData(0),step=Math.max(1,Math.floor(samples.length/Math.max(1,w)));
    c.strokeStyle='#77d8d2';c.lineWidth=1;c.beginPath();
    for(let x=0;x<w;x++){
      const start=Math.floor(x*step),end=Math.min(samples.length,start+step);
      if(start>=samples.length)break;
      let low=1,high=-1;
      for(let i=start;i<end;i++){low=Math.min(low,samples[i]);high=Math.max(high,samples[i]);}
      c.moveTo(x,mid-high*(h*.44));c.lineTo(x,mid-low*(h*.44));
    }
    c.stroke();
  }
  function fitCanvas(canvas){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
    canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));
    const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return {c,w,h};
  }
  function grid(c,w,h){c.clearRect(0,0,w,h);c.lineWidth=1;c.strokeStyle='#283c50';for(let i=1;i<4;i++){c.beginPath();c.moveTo(0,i*h/4);c.lineTo(w,i*h/4);c.stroke();}}
  function rawWave(type,p){switch(type){case 'triangle':return (2/Math.PI)*Math.asin(Math.sin(p));case 'square':return Math.sin(p)>=0?1:-1;case 'sawtooth':return 2*(p/(2*Math.PI)-Math.floor(p/(2*Math.PI)+.5));default:return Math.sin(p);}}
  function drawWave(){const {c,w,h}=fitCanvas($('waveCanvas'));grid(c,w,h);const values=[],count=Math.max(150,Math.round(w*2));
    if((audition||playing)&&analyser&&timeArray){analyser.getByteTimeDomainData(timeArray);const span=Math.min(timeArray.length,Math.max(10,Math.round(ctx.sampleRate/baseHz*3)));for(let k=0;k<count;k++){const t=timeArray.length-span+Math.round(k/(count-1)*(span-1));values.push((timeArray[t]-128)/128);}}
    else if(soundSource==='sample'&&sampleBuffer){const data=sampleBuffer.getChannelData(0);for(let k=0;k<count;k++)values.push(data[Math.min(data.length-1,Math.floor(k/(count-1)*(data.length-1)))]);}
    else{for(let k=0;k<count;k++){const p=k/(count-1)*Math.PI*6;let value=0;partials.forEach((t,i)=>{if(!t.muted)value+=t.level/100*rawWave(t.wave,p*(i+1));});values.push(value);}const peak=Math.max(1,...values.map(Math.abs));values.forEach((v,i)=>values[i]=v/peak*.9);}
    c.strokeStyle='#6cdad3';c.lineWidth=2;c.beginPath();values.forEach((v,i)=>{const x=i/(count-1)*w,y=h/2-v*h*.43;if(!i)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();}
  function drawSpectrum(){const {c,w,h}=fitCanvas($('spectrumCanvas'));grid(c,w,h);const gap=3,pad=10,bw=(w-2*pad-(MAX_PARTIALS-1)*gap)/MAX_PARTIALS;
    partials.forEach((p,i)=>{const a=p.muted?0:p.level/100,x=pad+i*(bw+gap),height=a*(h-31);c.fillStyle=i===22?'#a5a6ff':'#6cdad3';c.fillRect(x,h-24-height,Math.max(1,bw),height);if([0,5,11,17,22,23].includes(i)){c.fillStyle='#abbdd0';c.font='10px system-ui';c.textAlign='center';c.fillText(String(i+1),x+bw/2,h-7);}});}
  const drawVisuals=()=>{drawWave();drawSpectrum();};
  function animate(){
    if(raf)return;
    const tick=()=>{
      raf=0;
      if(playing&&ctx){updatePlayhead();if(ctx.currentTime>=sequenceEnd+.06){stopSequence(false);sequenceStatus(`演奏完了：${seqCount}音。`);}}
      if(playing||audition){drawWave();raf=requestAnimationFrame(tick);}else drawVisuals();
    };
    raf=requestAnimationFrame(tick);
  }
  window.addEventListener('resize',()=>{drawVisuals();updateNavigator();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)drawVisuals();});
  syncSongSettings();$('a4Hz').value=String(a4Hz);syncRollModeUi();$('sampleReferenceHz').value=sampleReferenceHz;renderMixer();renderRoll();syncPower();drawVisuals();updateSamplerUi();
})();
