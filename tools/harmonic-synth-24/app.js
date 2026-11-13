(() => {
      'use strict';
      const MAX = 24;
      const waveTypes = [ ['sine','正弦波'], ['triangle','三角波'], ['sawtooth','ノコギリ波'], ['square','矩形波'] ];
      const $ = id => document.getElementById(id);
      const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
      const fixedHz = n => n >= 1000 ? n.toLocaleString('ja-JP',{maximumFractionDigits:1}) : n.toFixed(2);
      const makePartials = () => Array.from({length:MAX},(_,i)=>({level: i===0?100 : i===1?28 : i===2?18 : i===3?11 : i===4?8 : i===5?6 : i===6?4 : i===7?3 : 0, wave:'sine', muted:false}));
      let baseHz = 261.625565;
      let master = 60;
      let partials = makePartials();
      let ctx = null, mixGain = null, masterGain = null, analyser = null, oscillators = [], gains = [], playing = false, frameId = 0;
      let sequencePlaying = false, sequenceBus = null, sequenceNodes = new Set(), sequenceEndTime = 0, sequenceStartTime = 0;
      let sequenceSummary = null;
      let timeData = null;
      const mixer = $('mixer');

      for (let i=0;i<MAX;i++) {
        const n=i+1;
        const row=document.createElement('div');
        row.className='harmonic'+(n===23?' is-23':'');
        row.dataset.index=String(i);
        row.innerHTML=`
          <div class="harmonic-top">
            <span class="number">${String(n).padStart(2,'0')}</span>
            <span class="hname"><strong>第${n}倍音 <span class="minor">(${n}:1)</span></strong><small class="freq">${fixedHz(baseHz*n)} Hz</small></span>
            <button type="button" class="mute" aria-label="第${n}倍音をミュート" aria-pressed="false">ミュート</button>
          </div>
          <div class="harmonic-bottom">
            <select class="wave-select" aria-label="第${n}倍音の波形">${waveTypes.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>
            <input class="level" aria-label="第${n}倍音の音量" type="range" min="0" max="100" step="1" value="${partials[i].level}">
            <output class="level-out">${partials[i].level}%</output>
          </div>`;
        mixer.appendChild(row);
        row.querySelector('.wave-select').addEventListener('change',ev=>{
          partials[i].wave=ev.target.value;
          updateAudio(); onEdit();
        });
        row.querySelector('.level').addEventListener('input',ev=>{
          partials[i].level=Number(ev.target.value);
          row.querySelector('.level-out').textContent=partials[i].level+'%';
          updateAudio(); onEdit();
        });
        row.querySelector('.mute').addEventListener('click',()=>{
          partials[i].muted=!partials[i].muted;
          reflectRow(i); updateAudio(); onEdit();
        });
      }
      const rows=Array.from(mixer.children);
      function reflectRow(i) {
        const row=rows[i], p=partials[i];
        row.querySelector('.wave-select').value=p.wave;
        row.querySelector('.level').value=String(p.level);
        row.querySelector('.level-out').textContent=p.level+'%';
        row.querySelector('.mute').setAttribute('aria-pressed',String(p.muted));
        row.querySelector('.mute').textContent=p.muted?'解除':'ミュート';
        row.classList.toggle('is-muted',p.muted);
        row.querySelector('.freq').textContent=fixedHz(baseHz*(i+1))+' Hz';
      }
      const refreshRows=()=>rows.forEach((_,i)=>reflectRow(i));
      const setStatus=(msg,type='')=>{$('status').textContent=msg;$('status').className='status'+(type?' '+type:'');};
      const onEdit=()=>{$('preset').value='custom';drawVisuals();};

      async function setupAudio() {
        const AudioCtx=window.AudioContext||window.webkitAudioContext;
        if(!AudioCtx) throw new Error('このブラウザはWeb Audio APIに対応していません。');
        ctx=new AudioCtx({latencyHint:'interactive'});
        mixGain=ctx.createGain(); mixGain.gain.value=0;
        masterGain=ctx.createGain(); masterGain.gain.value=0;
        const limiter=ctx.createDynamicsCompressor();
        limiter.threshold.value=-10; limiter.knee.value=4; limiter.ratio.value=16;
        limiter.attack.value=.002; limiter.release.value=.13;
        analyser=ctx.createAnalyser(); analyser.fftSize=4096;
        mixGain.connect(masterGain); masterGain.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
        for(let i=0;i<MAX;i++){
          const oscillator=ctx.createOscillator(),gain=ctx.createGain();
          oscillator.type=partials[i].wave;
          oscillator.frequency.value=baseHz*(i+1);
          gain.gain.value=0;
          oscillator.connect(gain); gain.connect(mixGain);
          oscillator.start(); oscillators.push(oscillator); gains.push(gain);
        }
        timeData=new Uint8Array(analyser.fftSize);
        updateAudio();
      }
      function updateAudio(){
        if(!ctx||!mixGain) return;
        const now=ctx.currentTime;
        const activeLevels=partials.map((p,i)=>p.muted || baseHz*(i+1)>=ctx.sampleRate/2 ? 0 : p.level/100);
        const rootPower=Math.sqrt(activeLevels.reduce((s,x)=>s+x*x,0));
        // RMS-based loudness compensation and limiting protect against clipping.
        mixGain.gain.setTargetAtTime(playing ? .60/Math.max(1,rootPower) : 0,now,.02);
        masterGain.gain.setTargetAtTime(master/100,now,.02);
        partials.forEach((p,i)=>{
          oscillators[i].type=p.wave;
          oscillators[i].frequency.setTargetAtTime(baseHz*(i+1),now,.015);
          gains[i].gain.setTargetAtTime(activeLevels[i],now,.015);
        });
      }
      const syncPlay=()=>{
        const anyPlaying=playing||sequencePlaying;
        $('playButton').textContent=playing?'■ 音を止める':'▶ 音を鳴らす';
        $('playButton').classList.toggle('playing',playing);
        $('powerDot').classList.toggle('on',anyPlaying);
        $('powerLabel').textContent=sequencePlaying?'自動演奏中':playing?'音色試聴中':'停止中';
        $('waveLabel').textContent=anyPlaying?'実際の出力波形（Web Audio）':'計算上のプレビュー';
        $('sequenceStop').disabled=!sequencePlaying;
        $('sequencePlay').textContent=sequencePlaying?'↻ 最初から再生':'▶ 自動演奏';
      };
      $('playButton').addEventListener('click',async()=>{
        const b=$('playButton');b.disabled=true;
        try{
          if(!ctx) await setupAudio();
          await ctx.resume();
          if(playing){
            playing=false;updateAudio();
            if(!sequencePlaying)cancelAnimationFrame(frameId);
            setStatus('音色試聴を停止しました。設定は保持されます。');
          }else{
            if(sequencePlaying)stopSequence(false);
            playing=true;updateAudio();
            setStatus('音色試聴中：スライダーと波形選択がリアルタイムに反映されます。');
            cancelAnimationFrame(frameId);frameId=requestAnimationFrame(animate);
          }
          syncPlay();drawVisuals();
        }catch(err){setStatus('音声の開始に失敗しました：'+(err?.message||String(err)),'err');}
        finally{b.disabled=false;}
      });
      $('baseHz').addEventListener('change',ev=>{
        const value=Number(ev.target.value);
        if(!Number.isFinite(value)||value<20||value>2000){ev.target.value=String(baseHz);setStatus('基音周波数は20〜2000 Hzで指定してください。','warn');return;}
        baseHz=value;refreshRows();updateAudio();onEdit();checkNyquist();
      });
      $('master').addEventListener('input',ev=>{
        master=Number(ev.target.value);$('masterValue').textContent=master+'%';updateAudio();
      });
      function checkNyquist(){
        const sampleRate=ctx?.sampleRate||44100;
        if(baseHz*24>=sampleRate/2){
          setStatus(`注意：第${Math.ceil(sampleRate/2/baseHz)}倍音以降はサンプリング周波数のナイキスト限界（${fixedHz(sampleRate/2)} Hz）以上となり、自動的に無音化されます。`,'warn');
        }
      }
      function setPreset(name){
        const ps=Array.from({length:MAX},()=>({level:0,wave:'sine',muted:false}));
        if(name==='pure')ps[0].level=100;
        else if(name==='organ')ps.forEach((p,i)=>{p.level=i<12?Math.round(100/Math.pow(i+1,1.05)):0;});
        else if(name==='string')ps.forEach((p,i)=>{p.level=Math.max(0,Math.round(90/Math.pow(i+1,.75)-(i>14?4:0)));});
        else if(name==='odd')ps.forEach((p,i)=>{p.level=i%2===0?Math.round(95/(i+1)**.72):0;});
        else if(name==='twentythree'){ps[0].level=75;ps[22].level=48;}
        else return;
        partials=ps;
        refreshRows();updateAudio();drawVisuals();
      }
      $('preset').addEventListener('change',ev=>setPreset(ev.target.value));
      $('reset').addEventListener('click',()=>{
        baseHz=261.625565;master=60;partials=makePartials();
        $('baseHz').value=String(baseHz);$('master').value=String(master);$('masterValue').textContent=master+'%';$('preset').value='custom';
        refreshRows();updateAudio();drawVisuals();setStatus('初期設定に戻しました。');
      });
      $('save').addEventListener('click',()=>{
        const data={format:'reiji-lab-harmonic-synth-24',version:1,baseHz,master,partials};
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='harmonic-synth-24-preset.json';a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        setStatus('24倍音の設定をJSONファイルに保存しました。');
      });
      $('load').addEventListener('click',()=>$('fileInput').click());
      $('fileInput').addEventListener('change',async ev=>{
        const file=ev.target.files?.[0];if(!file)return;
        try{
          if(file.size>1024*1024)throw new Error('ファイルが大きすぎます。');
          const data=JSON.parse(await file.text());
          if(data.format!=='reiji-lab-harmonic-synth-24'||!Array.isArray(data.partials)||data.partials.length!==MAX)throw new Error('対応する24倍音プリセットではありません。');
          if(!Number.isFinite(data.baseHz)||data.baseHz<20||data.baseHz>2000||!Number.isFinite(data.master)||data.master<0||data.master>100)throw new Error('周波数・音量に不正な値があります。');
          const clean=data.partials.map(p=>{
            if(!p||!Number.isFinite(p.level)||p.level<0||p.level>100||!waveTypes.some(x=>x[0]===p.wave)||typeof p.muted!=='boolean')throw new Error('倍音データが不正です。');
            return {level:Math.round(p.level),wave:p.wave,muted:p.muted};
          });
          baseHz=data.baseHz; master=data.master; partials=clean;
          $('baseHz').value=String(baseHz);$('master').value=String(master);$('masterValue').textContent=master+'%';$('preset').value='custom';
          refreshRows();updateAudio();drawVisuals();checkNyquist();setStatus('24倍音の設定を読み込みました。');
        }catch(err){setStatus('読み込みに失敗しました：'+(err?.message||String(err)),'err');}
        finally{ev.target.value='';}
      });

      $('sequenceLoad').addEventListener('click',()=>$('sequenceFileInput').click());
      $('sequenceFileInput').addEventListener('change',async ev=>{
        const file=ev.target.files?.[0];if(!file)return;
        try{
          if(file.size>150000)throw new Error('演奏JSONは15万バイト以内にしてください。');
          const raw=await file.text();
          const score=parseScore(raw);
          $('scoreInput').value=JSON.stringify(JSON.parse(raw),null,2);
          sequenceStatus(`${score.voices}声部 / ${score.events.length}音の演奏JSONを読み込みました。`);
        }catch(e){sequenceStatus('読み込みできません：'+(e?.message||String(e)),'err');}
        finally{ev.target.value='';}
      });

      function fit(canvas){
        const rect=canvas.getBoundingClientRect();
        const dpr=Math.min(window.devicePixelRatio||1,2);
        const w=Math.max(2,Math.round(rect.width*dpr)),h=Math.max(2,Math.round(rect.height*dpr));
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
        return {c,w:rect.width,h:rect.height};
      }
      function backdrop(c,w,h){
        c.clearRect(0,0,w,h);
        c.strokeStyle='#263850';c.lineWidth=1;
        for(let i=1;i<=3;i++){const y=i*h/4;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
        for(let i=1;i<=8;i++){const x=i*w/9;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
        c.strokeStyle='#4e677c';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();
      }
      function rawWave(w,phase){
        const a=phase/(2*Math.PI);
        switch(w){
          case 'triangle':return 2/Math.PI*Math.asin(Math.sin(phase));
          case 'square':return Math.sin(phase)>=0?1:-1;
          case 'sawtooth':return 2*(a-Math.floor(a+.5));
          default:return Math.sin(phase);
        }
      }
      function drawWave(){
        const {c,w,h}=fit($('waveCanvas'));backdrop(c,w,h);
        if(w<1)return;
        const values=[];
        if((playing||sequencePlaying)&&analyser&&timeData){
          analyser.getByteTimeDomainData(timeData);
          const count=Math.min(timeData.length,Math.max(12,Math.floor(ctx.sampleRate/baseHz*3)));
          const start=timeData.length-count;
          for(let i=0;i<Math.max(100,Math.floor(w*2));i++){
            const at=start+Math.min(count-1,Math.floor(i/Math.max(1,Math.floor(w*2)-1)*(count-1)));
            values.push((timeData[at]-128)/128);
          }
        }else{
          const count=Math.max(100,Math.floor(w*2));
          for(let j=0;j<count;j++){
            const phase=(j/(count-1))*Math.PI*2*3;
            let v=0;
            partials.forEach((p,i)=>{if(!p.muted)v+=(p.level/100)*rawWave(p.wave,phase*(i+1));});
            values.push(v);
          }
          const peak=Math.max(1,...values.map(Math.abs));
          for(let i=0;i<values.length;i++)values[i]*=.85/peak;
        }
        c.lineWidth=2;c.strokeStyle='#6cdad3';c.beginPath();
        for(let i=0;i<values.length;i++){
          const x=(i/(values.length-1))*w,y=h/2-(values[i]*h*.42);
          if(i===0)c.moveTo(x,y);else c.lineTo(x,y);
        }
        c.stroke();
      }
      function drawSpectrum(){
        const {c,w,h}=fit($('spectrumCanvas'));backdrop(c,w,h);
        const padX=12,padBottom=23,padTop=13;
        const gap=Math.max(3,w/160),barW=(w-padX*2-(MAX-1)*gap)/MAX;
        partials.forEach((p,i)=>{
          const x=padX+i*(barW+gap),a=p.muted?0:p.level/100;
          const bh=a*(h-padBottom-padTop),top=h-padBottom-bh;
          c.fillStyle=p.muted?'#47536a':i===22?'#a9a4ff':'#6cdad3';
          if(bh>0)c.fillRect(x,top,Math.max(1,barW),bh);
          if(i===0||i===5||i===11||i===17||i===22||i===23){
            c.font='10px system-ui,sans-serif';c.textAlign='center';c.fillStyle='#a6b7ce';
            c.fillText(String(i+1),x+barW/2,h-7);
          }
        });
      }

      // Default demonstration: four QUARTER NOTES (duration: 1) = C → F → G → C.
      // Each voice reads its own notes sequentially; all voices start together.
      // Ratios are relative to the "基音周波数" (C4 by default), not to each chord root.
      // C: (1,5/4,3/2) / F: (4/3,5/3,2) / G: (3/2,15/8,9/4).
      const demoScore = {
        "tempo": 72,
        "voices": [
          {
            "name": "高声部（G4 → C5 → D5 → G4）",
            "notes": [
              {
                "ratio": "3/2",
                "duration": 1
              },
              {
                "ratio": "2/1",
                "duration": 1
              },
              {
                "ratio": "9/4",
                "duration": 1
              },
              {
                "ratio": "3/2",
                "duration": 1
              }
            ]
          },
          {
            "name": "中声部（E4 → A4 → B4 → E4）",
            "notes": [
              {
                "ratio": "5/4",
                "duration": 1
              },
              {
                "ratio": "5/3",
                "duration": 1
              },
              {
                "ratio": "15/8",
                "duration": 1
              },
              {
                "ratio": "5/4",
                "duration": 1
              }
            ]
          },
          {
            "name": "低声部（C3 → F3 → G3 → C3）",
            "notes": [
              {
                "ratio": "1/2",
                "duration": 1
              },
              {
                "ratio": "2/3",
                "duration": 1
              },
              {
                "ratio": "3/4",
                "duration": 1
              },
              {
                "ratio": "1/2",
                "duration": 1
              }
            ]
          }
        ]
      };
      $('scoreInput').value=JSON.stringify(demoScore,null,2);
      const sequenceStatus=(msg,type='')=>{
        $('sequenceStatus').textContent=msg;
        $('sequenceStatus').className='sequence-status'+(type?' '+type:'');
      };
      function ratioNumber(ratio){
        let result;
        if(typeof ratio==='number') result=ratio;
        else if(Array.isArray(ratio)&&ratio.length===2){
          if(!ratio.every(x=>typeof x==='number'&&Number.isFinite(x)))throw new Error('比率の配列は [分子, 分母] の数値で指定してください。');
          result=ratio[0]/ratio[1];
        }else if(typeof ratio==='string'){
          const clean=ratio.trim();
          const pattern=/^(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?$/;
          if(!pattern.test(clean))throw new Error(`音程比「${clean.slice(0,50)}」の形式が不正です。例："3/2"`);
          const [a,b='1']=clean.split('/').map(x=>Number(x.trim()));
          result=a/b;
        }else throw new Error('ratio は "3/2"、数値、または [3,2] で指定してください。');
        if(!Number.isFinite(result)||result<=0)throw new Error('ratio は正の有限値で指定してください。');
        return result;
      }
      function parseScore(text){
        if(text.length>150000)throw new Error('JSONが長すぎます（15万文字以内）。');
        let data;
        try{data=JSON.parse(text);}catch(e){throw new Error('JSONの記述を確認してください：'+e.message);}
        if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('JSON全体はオブジェクトにしてください。');
        const tempo=Number(data.tempo??90);
        if(!Number.isFinite(tempo)||tempo<20||tempo>300)throw new Error('tempo は20〜300 BPMにしてください。');
        if(!Array.isArray(data.voices)||data.voices.length<1||data.voices.length>12)throw new Error('voices は1〜12声部の配列にしてください。');
        const secondsPerBeat=60/tempo;
        const events=[];
        let ending=0;
        data.voices.forEach((voice,voiceIndex)=>{
          if(!voice||!Array.isArray(voice.notes))throw new Error(`第${voiceIndex+1}声部の notes は配列にしてください。`);
          if(voice.notes.length>512)throw new Error(`第${voiceIndex+1}声部の音符が多すぎます。`);
          const vVolume=voice.volume===undefined?100:Number(voice.volume);
          if(!Number.isFinite(vVolume)||vVolume<0||vVolume>100)throw new Error(`第${voiceIndex+1}声部の volume は0〜100で指定してください。`);
          let cursor=0;
          voice.notes.forEach((note,noteIndex)=>{
            if(!note||typeof note!=='object'||Array.isArray(note))throw new Error(`第${voiceIndex+1}声部・第${noteIndex+1}音が不正です。`);
            const duration=Number(note.duration);
            if(!Number.isFinite(duration)||duration<=0||duration>256)throw new Error(`第${voiceIndex+1}声部・第${noteIndex+1}音の duration は0より大きく256以下にしてください。`);
            const start=note.start===undefined?cursor:Number(note.start);
            if(!Number.isFinite(start)||start<0||start>2048)throw new Error('start は0以上2048以下の拍数で指定してください。');
            cursor=start+duration;
            ending=Math.max(ending,cursor);
            if(note.rest===true||note.ratio===null) return;
            if(note.ratio===undefined)throw new Error(`第${voiceIndex+1}声部・第${noteIndex+1}音に ratio がありません。休符は ratio:null。`);
            const ratio=ratioNumber(note.ratio);
            const frequency=baseHz*ratio;
            if(frequency<20||frequency>=20000)throw new Error(`第${voiceIndex+1}声部・第${noteIndex+1}音：${fixedHz(frequency)} Hzは範囲外です（20〜20000 Hz未満）。`);
            const nVolume=note.volume===undefined?100:Number(note.volume);
            if(!Number.isFinite(nVolume)||nVolume<0||nVolume>100)throw new Error('音符の volume は0〜100で指定してください。');
            if(events.length>=512)throw new Error('一度に演奏できる音符は最大512音です。');
            events.push({frequency,start:start*secondsPerBeat,duration:duration*secondsPerBeat,amplitude:vVolume*nVolume/10000,voice:voiceIndex});
          });
        });
        if(events.length===0)throw new Error('演奏する音符がありません。');
        if(ending*secondsPerBeat>300)throw new Error('演奏時間が5分を超えています。短い曲に分けてください。');
        return {events,duration:ending*secondsPerBeat,tempo,voices:data.voices.length};
      }
      function makePeriodicWave(frequency,partialSnapshot,cache){
        const maxHarmonic=Math.min(4096,Math.floor((ctx.sampleRate/2-1)/frequency));
        if(maxHarmonic<1)throw new Error(`${fixedHz(frequency)} Hzは再生環境のナイキスト周波数を超えています。`);
        if(cache.has(maxHarmonic))return cache.get(maxHarmonic);
        const real=new Float32Array(maxHarmonic+1);
        const imaginary=new Float32Array(maxHarmonic+1);
        let sumSquares=0;
        partialSnapshot.forEach((p,i)=>{if(!p.muted)sumSquares+=Math.pow(p.level/100,2);});
        // One periodic oscillator reproduces the Fourier sum of 24 individually
        // configured wave generators. Higher components are removed at Nyquist.
        for(let i=0;i<MAX;i++){
          const p=partialSnapshot[i], n=i+1;
          if(p.muted||p.level===0||n>maxHarmonic)continue;
          const level=p.level/100;
          for(let k=1;k*n<=maxHarmonic;k++){
            let coefficient=0;
            switch(p.wave){
              case 'sine': if(k===1)coefficient=1; break;
              case 'square': if(k%2)coefficient=4/(Math.PI*k);break;
              case 'triangle': if(k%2)coefficient=8/(Math.PI*Math.PI*k*k)*(k%4===1?1:-1);break;
              case 'sawtooth': coefficient=2/(Math.PI*k)*(k%2?1:-1);break;
            }
            if(coefficient)imaginary[k*n]+=level*coefficient;
          }
        }
        const wave=ctx.createPeriodicWave(real,imaginary,{disableNormalization:true});
        const result={wave,scale:.60/Math.max(1,Math.sqrt(sumSquares))};
        cache.set(maxHarmonic,result);
        return result;
      }
      function stopSequence(announce=true){
        const now=ctx?.currentTime??0;
        if(sequenceBus&&ctx){
          sequenceBus.gain.cancelScheduledValues(now);
          sequenceBus.gain.setTargetAtTime(0,now,.006);
        }
        for(const node of sequenceNodes){
          try{node.osc.stop(Math.max(now+.035,node.at+.001));}catch(_e){}
        }
        sequenceNodes.clear();
        sequenceBus=null;
        sequencePlaying=false;
        sequenceEndTime=0;
        sequenceSummary=null;
        syncPlay();
        if(announce){sequenceStatus('演奏を停止しました。');setStatus('自動演奏を停止しました。');}
        if(!playing){cancelAnimationFrame(frameId);drawVisuals();}
      }
      async function startSequence(){
        const score=parseScore($('scoreInput').value);
        if(!ctx)await setupAudio();
        await ctx.resume();
        if(sequencePlaying)stopSequence(false);
        if(playing){playing=false;updateAudio();}
        // UI settings are captured at start. Changes take effect next performance.
        const snapshot=partials.map(p=>({...p}));
        const cache=new Map();
        const bus=ctx.createGain();bus.gain.value=1;bus.connect(masterGain);sequenceBus=bus;
        const at=ctx.currentTime+.12;
        const headroom=1/Math.sqrt(score.voices);
        let outstanding=score.events.length;
        try{
          for(const event of score.events){
            const {wave,scale}=makePeriodicWave(event.frequency,snapshot,cache);
            const osc=ctx.createOscillator(),env=ctx.createGain();
            osc.setPeriodicWave(wave);osc.frequency.value=event.frequency;
            const start=at+event.start,end=start+event.duration;
            const attack=Math.min(.014,event.duration*.18);
            const release=Math.min(.055,event.duration*.18);
            const level=scale*headroom*event.amplitude;
            env.gain.setValueAtTime(0,start);
            env.gain.linearRampToValueAtTime(level,start+attack);
            env.gain.setValueAtTime(level,Math.max(start+attack,end-release));
            env.gain.linearRampToValueAtTime(0,end);
            osc.connect(env);env.connect(bus);
            const node={osc,at:start};sequenceNodes.add(node);
            osc.onended=()=>{
              try{osc.disconnect();env.disconnect();}catch(_e){}
              sequenceNodes.delete(node);
              if(--outstanding===0)try{bus.disconnect();}catch(_e){}
            };
            osc.start(start);osc.stop(end+.03);
          }
        }catch(e){stopSequence(false);throw e;}
        sequencePlaying=true;
        sequenceStartTime=at;
        sequenceEndTime=at+score.duration;
        sequenceSummary={voices:score.voices,notes:score.events.length};
        syncPlay();
        sequenceStatus(`予約完了：${score.voices}声部 / ${score.events.length}音 / 約${score.duration.toFixed(1)}秒`);
        setStatus(`自動演奏：基音${fixedHz(baseHz)} Hz、${score.tempo} BPM。音色は演奏開始時の設定を使用します。`);
        cancelAnimationFrame(frameId);frameId=requestAnimationFrame(animate);
      }
      $('sequencePlay').addEventListener('click',async()=>{
        const b=$('sequencePlay');b.disabled=true;
        try{await startSequence();}
        catch(e){sequenceStatus('演奏できません：'+(e?.message||String(e)),'err');}
        finally{b.disabled=false;}
      });
      $('sequenceStop').addEventListener('click',()=>stopSequence());
      $('sequenceExample').addEventListener('click',()=>{
        $('scoreInput').value=JSON.stringify(demoScore,null,2);
        sequenceStatus('4分音符×4拍：C → F → G → C（3声部・純正調）を入力しました。');
      });
      $('sequenceSave').addEventListener('click',()=>{
        let json;
        try{parseScore($('scoreInput').value);json=JSON.stringify(JSON.parse($('scoreInput').value),null,2);}
        catch(e){sequenceStatus('保存できません：'+e.message,'err');return;}
        const blob=new Blob([json],{type:'application/json'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='harmonic-synth-24-score.json';a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        sequenceStatus('演奏JSONを保存しました。');
      });

      const drawVisuals=()=>{drawWave();drawSpectrum();};
      const animate=()=>{
        if(!playing&&!sequencePlaying)return;
        drawWave();
        if(sequencePlaying&&ctx){
          const remaining=sequenceEndTime-ctx.currentTime;
          if(remaining<=-.12){
            stopSequence(false);
            $('sequenceStatus').textContent='演奏が完了しました。';
            setStatus('自動演奏が完了しました。');
            drawVisuals();
            return;
          }
          $('sequenceStatus').textContent=`演奏中：${sequenceSummary?.voices||0}声部 / ${sequenceSummary?.notes||0}音 / 残り約${Math.max(0,remaining).toFixed(1)}秒`;
        }
        frameId=requestAnimationFrame(animate);
      };
      window.addEventListener('resize',drawVisuals,{passive:true});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)drawVisuals();});
      syncPlay();refreshRows();drawVisuals();
    })();
