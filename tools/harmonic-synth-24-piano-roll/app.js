(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_LANES = 40, MAX_PARTIALS = 24, MAX_NOTES = 512, LABEL_WIDTH = 282;
  const waves = [['sine','正弦波'],['triangle','三角波'],['sawtooth','ノコギリ波'],['square','矩形波']];
  const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));
  const fmt = x => Number(x.toFixed(4)).toString();
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
  function makeDemo() {
    const config=[
      ['15/8','B4',[[8,4]]], ['5/3','A4',[[4,4]]],
      ['3/2','G4',[[0,4],[8,4],[12,4]]], ['4/3','F4',[[4,4]]],
      ['5/4','E4',[[0,4],[12,4]]], ['9/8','D4',[[8,4]]],
      ['1/1','C4',[[0,4],[4,4],[12,4]]],
      ['3/4','G3',[[8,4]]], ['2/3','F3',[[4,4]]], ['1/2','C3',[[0,4],[12,4]]]
    ];
    return config.map(([ratio,name,events])=>({id:id('lane-'),ratio,name,volume:85,notes:events.map(([start,duration])=>newNote(start,duration))}));
  }
  let baseHz=261.625565, master=55, tempo=72, beatsPerBar=4, bars=4, snap=.25, beatPx=54;
  let lanes=makeDemo(), selected=null;
  let partials=makePartials('organ');
  let ctx=null, masterGain=null, analyser=null, previewBus=null, audition=false;
  let oscBank=[],gainBank=[], sequenceBus=null, sequenceNodes=new Set(),playing=false;
  let sequenceStart=0, sequenceEnd=0, seqCount=0, raf=0, timeArray=null;

  function makePartials(type='organ') {
    return Array.from({length:MAX_PARTIALS},(_,i)=>({level:type==='pure'?(i===0?100:0):type==='organ'?(i<12?Math.round(100/(i+1)**1.05):0):type==='string'?Math.max(0,Math.round(90/(i+1)**.75-(i>14?4:0))):type==='odd'?(i%2===0?Math.round(95/(i+1)**.72):0):type==='twentythree'?(i===0?75:i===22?48:0):i===0?100:0,wave:'sine',muted:false}));
  }
  function syncPower() {
    const active=audition||playing;
    $('powerDot').classList.toggle('on',active);
    $('powerLabel').textContent=playing?'自動演奏中':audition?'音色試聴中':'停止中';
    $('playButton').textContent=audition?'■ 試聴を停止':'♪ 音色を試聴';
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
  async function previewLane(lane){
    const r=parseRatio(lane.ratio), freq=baseHz*r;
    await setupAudio();
    const cache=new Map(),nodes=new Set(),bus=ctx.createGain();bus.connect(masterGain);
    scheduleNote(bus,ctx.currentTime+.02,.65,freq,lane.volume/100,partials.map(p=>({...p})),cache,.7,nodes);
    setTimeout(()=>{try{bus.disconnect();}catch(_e){}},1250);
    status(`${lane.name||lane.ratio}：${fixedHz(freq)} Hz を試聴しました。`);
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
      const freq=baseHz*parseRatio(lane.ratio);
      for(const note of lane.notes){events.push({freq,start:note.start,duration:note.duration,volume:lane.volume*note.volume/10000});}
    }
    if(events.length===0)throw Error('音符がありません。タイムラインの空白をクリックして配置してください。');
    if(events.length>MAX_NOTES)throw Error('1曲の音符は512個以内にしてください。');
    if(totalBeats()*60/tempo>600)throw Error('演奏時間が10分を超えます。テンポや小節数を調整してください。');
    return events;
  }
  async function startSequence(){
    const events=songEvents();await setupAudio();
    if(playing)stopSequence(false);
    if(audition){audition=false;refreshAudio();}
    const bus=ctx.createGain();bus.gain.value=1;bus.connect(masterGain);sequenceBus=bus;
    const snapShot=partials.map(p=>({...p})),cache=new Map(), start=ctx.currentTime+.12;
    const secs=60/tempo,headroom=0.8/Math.sqrt(Math.max(1,Math.min(40,lanes.filter(l=>l.notes.length).length)));
    try{
      for(const event of events){scheduleNote(bus,start+event.start*secs,event.duration*secs,event.freq,event.volume,snapShot,cache,headroom,sequenceNodes);}
    }catch(e){stopSequence(false);throw e;}
    sequenceStart=start;sequenceEnd=start+totalBeats()*secs;seqCount=events.length;playing=true;
    syncPower();sequenceStatus(`再生中：${events.length}音 / ${lanes.length}音階行 / ${tempo} BPM。音色変更は次の再生から反映されます。`);
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
    try{if(!audition){await setupAudio();if(playing)stopSequence(false);audition=true;}else audition=false;
      refreshAudio();syncPower();animate();status(audition?'音色を試聴中です。':'音色の試聴を停止しました。');}
    catch(e){status(e.message,'err');}
  });

  const totalBeats=()=>beatsPerBar*bars;
  const snapTo=(v)=>Math.round(v/snap)*snap;
  const allNotes=()=>lanes.reduce((sum,lane)=>sum+lane.notes.length,0);
  const getSelected=()=>{if(!selected)return null;const lane=lanes.find(l=>l.id===selected.laneId);const note=lane?.notes.find(n=>n.id===selected.noteId);return lane&&note?{lane,note}:null;};
  function renderInspector(){
    const s=getSelected(),enabled=!!s;
    ['noteStart','noteDuration','noteVolume','deleteNote'].forEach(key=>{$(key).disabled=!enabled;});
    $('selectionName').textContent=s?`${s.lane.name||s.lane.ratio}（${s.lane.ratio}）`:'音符を選択してください';
    if(s){
      $('noteStart').value=fmt(s.note.start);$('noteDuration').value=fmt(s.note.duration);$('noteVolume').value=s.note.volume;
      $('positionLabel').textContent=`第${Math.floor(s.note.start/beatsPerBar)+1}小節 / ${fmt(s.note.start%beatsPerBar+1)}拍目 → 長さ ${fmt(s.note.duration)}拍。1拍は4分音符です。`;
    }else{$('noteStart').value='';$('noteDuration').value='';$('noteVolume').value='';$('positionLabel').textContent='空白をクリックすると、その行の音程比で音符が追加されます。空白の区間が休符です。';}
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
      const v=Number(e.target.value),end=totalBeats();
      if(!Number.isFinite(v)|| (key==='volume'?(v<0||v>100):key==='start'?(v<0||v+s.note.duration>end):(v<snap||s.note.start+v>end))){
        sequenceStatus('音符の開始位置・長さは小節内の範囲で指定してください。','err');renderInspector();return;
      }
      s.note[key]=key==='volume'?Math.round(v):v;renderRoll();
    });
  }
  function renderRoll(){
    const container=$('rollContent'),scroll=$('scrollTimeline'),keepX=scroll.scrollLeft,keepY=scroll.scrollTop;
    const total=totalBeats(),width=total*beatPx,barWidth=beatsPerBar*beatPx;
    container.innerHTML='';container.style.width=(LABEL_WIDTH+width)+'px';
    const ruler=document.createElement('div');ruler.className='ruler-row';
    const corner=document.createElement('div');corner.className='corner';corner.innerHTML='<span>音程比（自由入力）</span><small>音量%</small>';
    const rulerTrack=document.createElement('div');rulerTrack.className='ruler-track';rulerTrack.style.width=width+'px';
    for(let bar=0;bar<bars;bar++){
      const label=document.createElement('div');label.className='bar-label';label.style.left=bar*barWidth+'px';label.style.width=barWidth+'px';label.textContent=`${bar+1} 小節`;rulerTrack.append(label);
    }
    for(let beat=1;beat<total;beat++)if(beat%beatsPerBar){const tick=document.createElement('div');tick.className='beat-tick';tick.style.left=(beat*beatPx)+'px';rulerTrack.append(tick);}
    ruler.append(corner,rulerTrack);container.append(ruler);
    lanes.forEach((lane,laneIndex)=>{
      const row=document.createElement('div');row.className='note-row';
      const info=document.createElement('div');info.className='lane-info';
      const index=document.createElement('span');index.className='lane-index';index.textContent=String(laneIndex+1).padStart(2,'0');
      const ratio=document.createElement('input');ratio.className='lane-ratio';ratio.value=lane.ratio;ratio.title='周波数比。例：3/2、23/16';ratio.setAttribute('aria-label',`第${laneIndex+1}音の周波数比`);
      ratio.addEventListener('change',()=>{
        try{const val=parseRatio(ratio.value);if(baseHz*val<20||baseHz*val>=22050)throw Error('指定比率で発生する周波数が範囲外です。');lane.ratio=ratio.value.trim();lane.name='';renderRoll();}
        catch(e){ratio.value=lane.ratio;sequenceStatus(e.message,'err');}
      });
      const hz=document.createElement('span');hz.className='lane-hz';
      try{hz.textContent=fixedHz(baseHz*parseRatio(lane.ratio))+' Hz';}catch(e){hz.textContent='無効';info.classList.add('bad-ratio');}
      const vol=document.createElement('input');vol.className='lane-vol';vol.type='number';vol.min='0';vol.max='100';vol.step='1';vol.value=lane.volume;vol.title='この音の音量（%）';vol.setAttribute('aria-label',`第${laneIndex+1}音の音量`);
      vol.addEventListener('change',()=>{const v=Number(vol.value);if(!Number.isInteger(v)||v<0||v>100){vol.value=lane.volume;sequenceStatus('音量は0〜100%で指定してください。','err');return;}lane.volume=v;});
      const hear=document.createElement('button');hear.className='lane-play';hear.type='button';hear.textContent='▶';hear.title='この音を試聴';hear.addEventListener('click',async()=>{try{await previewLane(lane);}catch(e){sequenceStatus(e.message,'err');}});
      const del=document.createElement('button');del.className='lane-delete';del.type='button';del.textContent='×';del.title='この音程行を削除';del.setAttribute('aria-label',`第${laneIndex+1}音を削除`);
      del.addEventListener('click',()=>{
        if(lanes.length<=1){sequenceStatus('最後の1音は削除できません。','warn');return;}
        if(lane.notes.length&&!confirm('この音程行にある音符も削除します。続けますか？'))return;
        lanes=lanes.filter(l=>l.id!==lane.id);if(selected?.laneId===lane.id)selected=null;renderRoll();
      });
      info.append(index,ratio,hz,vol,hear,del);
      const track=document.createElement('div');track.className='lane-track';track.style.width=width+'px';
      track.style.backgroundImage='linear-gradient(to right, #455770 1px, transparent 1px), linear-gradient(to right, #293e55 1px, transparent 1px)';
      track.style.backgroundSize=`${barWidth}px 100%, ${beatPx}px 100%`;
      track.setAttribute('aria-label',`${lane.ratio} のタイムライン。空白をクリックして音符を配置`);
      track.addEventListener('click',ev=>{
        if(ev.target.closest('.note-block'))return;
        if(allNotes()>=MAX_NOTES){sequenceStatus('音符は最大512個です。','warn');return;}
        const x=ev.clientX-track.getBoundingClientRect().left;
        const start=clamp(Math.floor((x/beatPx)/snap)*snap,0,Math.max(0,total-snap));
        const duration=Math.min(1,total-start),note=newNote(start,duration);
        lane.notes.push(note);selected={laneId:lane.id,noteId:note.id};renderRoll();
        sequenceStatus(`音符を追加：${lane.ratio}、開始 ${fmt(start)}拍、長さ ${fmt(duration)}拍。`);
      });
      lane.notes.forEach(note=>{
        const el=document.createElement('div');el.className='note-block';el.tabIndex=0;el.setAttribute('role','button');el.dataset.noteId=note.id;
        const w=note.duration*beatPx;el.style.left=(note.start*beatPx+1)+'px';el.style.width=Math.max(7,w-2)+'px';
        if(w<36)el.classList.add('too-small');if(selected?.noteId===note.id)el.classList.add('selected');
        const text=document.createElement('span');text.className='note-text';text.textContent=lane.ratio;
        const handle=document.createElement('span');handle.className='resize-handle';handle.title='音符の長さを変更';
        el.append(text,handle);
        el.addEventListener('click',e=>{e.stopPropagation();selectNote(lane.id,note.id);});
        el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNote(lane.id,note.id);}});
        el.addEventListener('pointerdown',e=>{
          if(e.button!==0)return;
          e.preventDefault();e.stopPropagation();
          selectNote(lane.id,note.id);
          const resize=e.target===handle||e.offsetX>el.clientWidth-13;
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
    $('trackCount').textContent=`${lanes.length} / ${MAX_LANES} 音`;
    $('measureText').textContent=`${bars}小節 · ${total}拍 · ${allNotes()}音符`;
    $('addLane').disabled=lanes.length>=MAX_LANES;
    scroll.scrollLeft=keepX;scroll.scrollTop=keepY;
    renderInspector();updateNavigator();if(playing)updatePlayhead();
  }
  function updateNavigator(){
    const sc=$('scrollTimeline'),max=sc.scrollWidth-sc.clientWidth;
    $('horizontalNav').value=max>0?Math.round(sc.scrollLeft/max*1000):0;
    $('horizontalNav').disabled=max<=0;
    $('navPosition').textContent=max?Math.round(sc.scrollLeft/max*100)+'%':'全体表示';
  }
  $('scrollTimeline').addEventListener('scroll',updateNavigator,{passive:true});
  $('horizontalNav').addEventListener('input',e=>{const sc=$('scrollTimeline');sc.scrollLeft=(sc.scrollWidth-sc.clientWidth)*Number(e.target.value)/1000;});
  $('addLane').addEventListener('click',()=>{if(lanes.length>=MAX_LANES)return;lanes.push(newLane());renderRoll();const sc=$('scrollTimeline');sc.scrollTop=sc.scrollHeight;sequenceStatus(`音程行を追加しました（${lanes.length}/${MAX_LANES}）。左側の1/1を編集してください。`);});
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
    const lastNoteEnd=lanes.reduce((max,lane)=>
      lane.notes.reduce((end,note)=>Math.max(end,note.start+note.duration),max),0);
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
    if(!Number.isInteger(b)||b<1||b>64||lanes.some(l=>l.notes.some(n=>n.start+n.duration>b*beatsPerBar+1e-6))){e.target.value=bars;sequenceStatus('小節数は1〜64。配置済みの音符を切り捨てる変更はできません。','warn');return;}
    bars=b;renderRoll();
  });
  $('snap').addEventListener('change',e=>{snap=Number(e.target.value);});
  $('zoom').addEventListener('input',e=>{beatPx=Number(e.target.value);$('zoomLabel').textContent=beatPx+'px/拍';renderRoll();});
  $('sequencePlay').addEventListener('click',async()=>{const b=$('sequencePlay');b.disabled=true;try{await startSequence();}catch(e){announceError(e);}finally{b.disabled=false;}});
  $('sequenceStop').addEventListener('click',()=>stopSequence());
  $('resetScore').addEventListener('click',()=>{
    if(playing)stopSequence(false);
    tempo=72;beatsPerBar=4;bars=4;snap=.25;beatPx=54;lanes=makeDemo();selected=null;
    $('tempo').value=tempo;$('meter').value=beatsPerBar;$('bars').value=bars;$('snap').value=snap;$('zoom').value=beatPx;$('zoomLabel').textContent=beatPx+'px/拍';
    $('scrollTimeline').scrollLeft=0;$('scrollTimeline').scrollTop=0;renderRoll();sequenceStatus('サンプルを復元しました：4/4拍子・4小節、C → F → G → C。');
  });
  function validTimbre(data){
    if(!Array.isArray(data)||data.length!==MAX_PARTIALS)throw Error('24倍音のデータが不正です。');
    return data.map(p=>{if(!p||!Number.isFinite(p.level)||p.level<0||p.level>100||!waves.some(x=>x[0]===p.wave)||typeof p.muted!=='boolean')throw Error('倍音データに不正な値があります。');return {level:p.level,wave:p.wave,muted:p.muted};});
  }
  function exportFile(name,value){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('saveSong').addEventListener('click',()=>exportFile('reiji-lab-ratio-roll-song.json',{
    format:'reiji-lab-ratio-piano-roll',version:1,baseHz,master,tempo,beatsPerBar,bars,lanes:lanes.map(l=>({name:l.name,ratio:l.ratio,volume:l.volume,notes:l.notes.map(n=>({start:n.start,duration:n.duration,volume:n.volume}))})),partials
  }));
  $('loadSong').addEventListener('click',()=>$('songFile').click());
  $('songFile').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      if(f.size>3e5)throw Error('ファイルが大きすぎます。');
      const d=JSON.parse(await f.text());
      if(d.format!=='reiji-lab-ratio-piano-roll'||!Array.isArray(d.lanes)||d.lanes.length<1||d.lanes.length>MAX_LANES)throw Error('このアプリの曲データではありません。');
      if(![2,3,4,6].includes(d.beatsPerBar)||!Number.isInteger(d.bars)||d.bars<1||d.bars>64||!Number.isFinite(d.tempo)||d.tempo<20||d.tempo>300||!Number.isFinite(d.baseHz)||d.baseHz<20||d.baseHz>2000||!Number.isFinite(d.master)||d.master<0||d.master>100)throw Error('曲の基本設定が不正です。');
      let count=0;
      const clean=d.lanes.map(l=>{
        if(!l||typeof l.ratio!=='string'||!Array.isArray(l.notes)||!Number.isFinite(l.volume)||l.volume<0||l.volume>100)throw Error('音程行の値が不正です。');
        const r=parseRatio(l.ratio);if(d.baseHz*r<20||d.baseHz*r>=22050)throw Error('周波数比が再生可能範囲外です。');
        const notes=l.notes.map(n=>{
          if(!n||!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.duration)||n.duration<=0||n.start+n.duration>d.bars*d.beatsPerBar+1e-6||!Number.isFinite(n.volume)||n.volume<0||n.volume>100)throw Error('音符の値が不正です。');
          count++;return {id:id('note-'),start:n.start,duration:n.duration,volume:n.volume};
        });return {id:id('lane-'),name:typeof l.name==='string'?l.name.slice(0,30):'',ratio:l.ratio,volume:l.volume,notes};
      });
      if(count>MAX_NOTES)throw Error('音符は512個以内にしてください。');
      const importedPartials=d.partials?validTimbre(d.partials):partials;
      if(playing)stopSequence(false);
      lanes=clean;partials=importedPartials;tempo=d.tempo;beatsPerBar=d.beatsPerBar;bars=d.bars;baseHz=d.baseHz;master=d.master;selected=null;
      $('tempo').value=tempo;$('meter').value=beatsPerBar;$('bars').value=bars;$('baseHz').value=baseHz;$('master').value=master;$('masterValue').textContent=master+'%';$('preset').value='custom';
      refreshAudio();renderMixer();renderRoll();drawVisuals();sequenceStatus(`読み込み完了：${lanes.length}音階行・${count}音符。`);
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
  function fitCanvas(canvas){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
    canvas.width=Math.max(1,Math.floor(w*dpr));canvas.height=Math.max(1,Math.floor(h*dpr));
    const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return {c,w,h};
  }
  function grid(c,w,h){c.clearRect(0,0,w,h);c.lineWidth=1;c.strokeStyle='#283c50';for(let i=1;i<4;i++){c.beginPath();c.moveTo(0,i*h/4);c.lineTo(w,i*h/4);c.stroke();}}
  function rawWave(type,p){switch(type){case 'triangle':return (2/Math.PI)*Math.asin(Math.sin(p));case 'square':return Math.sin(p)>=0?1:-1;case 'sawtooth':return 2*(p/(2*Math.PI)-Math.floor(p/(2*Math.PI)+.5));default:return Math.sin(p);}}
  function drawWave(){const {c,w,h}=fitCanvas($('waveCanvas'));grid(c,w,h);const values=[],count=Math.max(150,Math.round(w*2));
    if((audition||playing)&&analyser&&timeArray){analyser.getByteTimeDomainData(timeArray);const span=Math.min(timeArray.length,Math.max(10,Math.round(ctx.sampleRate/baseHz*3)));for(let k=0;k<count;k++){const t=timeArray.length-span+Math.round(k/(count-1)*(span-1));values.push((timeArray[t]-128)/128);}}
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
  renderMixer();renderRoll();syncPower();drawVisuals();
})();
