/* 田中正平 純正調オルガン Web試作版
 * 基準音・18調・P/O・長短調の比率は TanakaOrgan_15_18keys.py から移植。
 * 音声はWeb Audioで再合成。PythonとPCM一致ではないためiPad実機の聴感調整が必要。
 */
(() => {
  'use strict';
  const BASE_FREQ = 261.625565;
  const MAX_SHIFT = 2, MIN_SHIFT = -2;
  const TONICS = [
    ['G−1','20/27',false],['g−1','20/27',true],['A♭','64/81',false],
    ['A−1','5/6',false],['a−1','5/6',true],['b−1','640/729',true],
    ['B','8/9',false],['H−1','15/16',false],['c−1','80/81',true],
    ['C','1/1',false],['D♭','256/243',false],['D−1','10/9',false],
    ['d−1','10/9',true],['E♭','32/27',false],['E−1','5/4',false],
    ['f−1','320/243',true],['F','4/3',false],['F♯−1','45/32',false],
  ];
  const BASE = {
    Z:'1/1',S:'10/9',E:'135/128','4':'25/24',
    X:'9/8',D:'81/64',R:'75/64',C:'5/4',F:'675/512',V:'4/3',
    G:'40/27',Y:'45/32','7':'25/18',B:'3/2',H:'27/16',U:'25/16',
    N:'5/3',J:'16/9',I:'225/128',M:'15/8',K:'2025/1024',',':'2/1'
  };
  const P = {'4':'16/15',R:'6/5',F:'27/20','7':'64/45',U:'8/5',I:'9/5'};
  const O = {X:'800/729',D:'100/81',G:'3200/2187',H:'400/243'};
  const MINOR = {Z:'1/1',X:'9/8',C:'6/5',V:'4/3',B:'3/2',N:'8/5',M:'9/5',',':'2/1'};
  const MINOR_P = {R:'5/4',U:'5/3',I:'15/8'};
  // 鍵盤上の音名はドイツ音名（B=変ロ、H=ロ）。比率を正確な音高の根拠とする。
  // 下記は「比率に対して確定できる表記」。その他の移調後の比率は
  // 12平均律で最も近い音名に ≈ を付ける（歴史的な綴りを断定しない）。
  // C♯−2 は 25/24、C♯−1 は 135/128。差は正確に 81/80（シントニックコンマ）。
  const EXACT_NAMES = Object.freeze({
    '1/1':'C','10/9':'D−1','135/128':'C♯−1','25/24':'C♯−2',
    '9/8':'D','81/64':'E','75/64':'D♯−2','5/4':'E−1',
    '675/512':'E♯−2','4/3':'F','40/27':'G−1','45/32':'F♯−1',
    '25/18':'F♯−2','3/2':'G','27/16':'A','25/16':'G♯−2',
    '5/3':'A−1','16/9':'B','225/128':'A♯−2','15/8':'H−1',
    '2025/1024':'H♯−2',
    // A−1調で元の25/24鍵を弾いた音の指定音名。
    // (5/6)×(25/24)=125/144、オクターブ正規化すると125/72。
    '125/72':'B−2',
    // E−1調で元のG♯−2(25/16)鍵を押すと(5/4)×(25/16)=125/64。
    // 近似音名 ≈C ではなく、指定どおり B♯−3 と表示する。
    '125/64':'B♯−3',
    '16/15':'D♭+1','6/5':'E♭','27/20':'F+1',
    '8/5':'A♭','9/5':'B+1',
    '800/729':'D−2','100/81':'E−2','3200/2187':'G−2',
    '400/243':'A−2',
    // 18調の既知の固定音高。Cを1とし、Cより下は1オクターブ上に正規化する。
    '128/81':'A♭','1280/729':'B−1','160/81':'C−1',
    '256/243':'D♭','32/27':'E♭','320/243':'F−1',
  });
  const CHROMATIC_GERMAN = ['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B','H'];
  function gcd(a,b){while(b!==0){const tmp=b;b=a%b;a=tmp;}return a;}
  function normalizedRatio(a,b){
    while(a<b)a*=2;
    while(a>=2*b)b*=2;
    const common=gcd(a,b);
    return `${a/common}/${b/common}`;
  }
  function nameFor(oct,key){
    if(key==='Z'){
      const tonicName=TONICS[state.tonic][0];
      return tonicName[0].toUpperCase()+tonicName.slice(1);
    }
    // 正確な有理数比で移調後の音名を求める。数値丸めは一切しない。
    const [tn,td]=TONICS[state.tonic][1].split('/').map(Number);
    const [kn,kd]=ratioFor(key).split('/').map(Number);
    const ratio=normalizedRatio(tn*kn,td*kd);
    // C調・P切替の64/45はユーザー確認済みのG♭+1。
    // F♯への平均律的な異名同音変換を防ぐ。別調での同一比率には流用しない。
    if(state.tonic===9 && state.p && key==='7' && ratio==='64/45')return 'G♭+1';
    if(Object.prototype.hasOwnProperty.call(EXACT_NAMES,ratio))return EXACT_NAMES[ratio];
    // tonicの名前そのものは、同じ比率の異名があっても選択した調名を優先。
    // ほかの音は既知の表にない場合、近似を明記する。
    const x=tn*kn/(td*kd);
    const cents=1200*Math.log2(x);
    const semitone=((Math.round(cents/100)%12)+12)%12;
    return '≈'+CHROMATIC_GERMAN[semitone];
  }
  const WHITES = ['Z','X','C','V','B','N','M',','];
  const COLUMNS = [['S','E','4'],['D','R'],['F'],['G','Y','7'],['H','U'],['J','I'],['K']];
  const el = id => document.getElementById(id);
  const state = {tonic:9, p:false,o:false,octave:0,sustain:false};
  const keyElements = new Map();
  const pointerNotes = new Map();
  const heldCounts = new Map();
  const voices = new Map();
  const echoNodes = new Set();
  let context=null, periodic=null, master=null, compressor=null;
  const parseRatio = text => { const [n,d] = text.split('/').map(Number);return n/d; };
  const minorMode = () => TONICS[state.tonic][2];
  function ratioFor(key) {
    if (state.o && Object.prototype.hasOwnProperty.call(O,key)) return O[key];
    if (minorMode() && state.p && Object.prototype.hasOwnProperty.call(MINOR_P,key))return MINOR_P[key];
    if (state.p && Object.prototype.hasOwnProperty.call(P,key) && !(minorMode() && Object.prototype.hasOwnProperty.call(MINOR,key)))return P[key];
    if (minorMode() && Object.prototype.hasOwnProperty.call(MINOR,key))return MINOR[key];
    return BASE[key];
  }
  function frequency(oct,key) {
    return BASE_FREQ*parseRatio(TONICS[state.tonic][1])*parseRatio(ratioFor(key))*Math.pow(2,oct+state.octave);
  }
  // 鍵盤上の分数は選択された調の主音を1とした比率。
  // 2オクターブ目は×2（最後の主音は4/1）。移調操作だけでは分数は変えない。
  function displayedRatio(oct,key) {
    const [n,d]=ratioFor(key).split('/').map(Number);
    const numerator=n*(oct===1?2:1),factor=gcd(numerator,d);
    return `${numerator/factor}/${d/factor}`;
  }
  const idFor = (oct,key) => `${oct}:${key}`;
  function noteFromId(id) { const [oct,key]=id.split(':');return {oct:Number(oct),key}; }

  /* Python 1.3の7倍音+非線形tanhに対応する周期波形をフーリエ解析する。
     WebAudioオシレータは基音周波数を直接指定するため、再生速度の2倍化を防げる。 */
  function buildPeriodicWave(ctx) {
    const N=2048, H=128, real=new Float32Array(H+1), imag=new Float32Array(H+1);
    const harmonics=[[1,1],[2,.73],[3,.52],[4,.41],[5,.31],[6,.27],[7,.24]];
    const norm=harmonics.reduce((acc,x)=>acc+x[1],0), v=new Float64Array(N);
    for(let n=0;n<N;n++) {
      const theta=2*Math.PI*n/N;
      let s=0;
      for (const [h,amp] of harmonics) s+=amp*Math.sin(h*theta+0.10*h);
      v[n]=Math.tanh(1.55*s/norm)/Math.tanh(1.55);
    }
    for(let k=1;k<=H;k++) {
      let a=0,b=0;
      for(let n=0;n<N;n++) {
        const theta=2*Math.PI*k*n/N;
        a+=v[n]*Math.cos(theta);b+=v[n]*Math.sin(theta);
      }
      real[k]=2*a/N;imag[k]=2*b/N;
    }
    return ctx.createPeriodicWave(real,imag,{disableNormalization:true});
  }
  function audioReadyUI(ready) {
    el('audio-light').classList.toggle('ready',ready);
    el('audio-status').textContent=ready?'音声ON · マルチタッチ対応':'音声を有効にしてください';
    el('sound-on').hidden=ready;
  }
  function ensureAudio() {
    try {
      if(!context){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC)throw new Error('Web Audio非対応');
        context=new AC({latencyHint:'interactive'});
        periodic=buildPeriodicWave(context);
        compressor=context.createDynamicsCompressor();
        compressor.threshold.value=-8;
        compressor.knee.value=8;
        compressor.ratio.value=4;
        compressor.attack.value=.003;
        compressor.release.value=.18;
        master=context.createGain();master.gain.value=.86;
        master.connect(compressor);compressor.connect(context.destination);
      }
      if(context.state!=='running')context.resume().then(()=>audioReadyUI(true)).catch(console.warn);
      if(context.state==='running')audioReadyUI(true);
      return true;
    }catch(err){
      el('audio-status').textContent='音声エラー: '+String(err.message||err);
      console.error(err);return false;
    }
  }
  function makeOscillator(freq, at) {
    const osc=context.createOscillator();osc.setPeriodicWave(periodic);
    osc.frequency.setValueAtTime(freq,at);
    return osc;
  }
  function attackEcho(freq,now) {
    // 1.3の起音エコー：最初のアタックと85ms/170msの2回の短い反射
    [1,.18,.18*.42].forEach((amp,i)=>{
      const at=now+i*.085;
      const osc=makeOscillator(freq,at),gain=context.createGain();
      gain.gain.setValueAtTime(0,at);
      gain.gain.linearRampToValueAtTime(.065*amp,at+.006);
      gain.gain.exponentialRampToValueAtTime(.00006,at+.36);
      gain.gain.setValueAtTime(0,at+.37);
      osc.connect(gain);gain.connect(master);
      const echoNode={osc,gain};echoNodes.add(echoNode);
      osc.start(at);osc.stop(at+.38);
      osc.onended=()=>{echoNodes.delete(echoNode);try{osc.disconnect();gain.disconnect();}catch(_){}};
    });
  }
  function stopVoice(id,immediate=false) {
    const voice=voices.get(id);if(!voice)return;
    voices.delete(id);
    const t=context?context.currentTime:0;
    if(context){
      try {
        voice.gain.gain.cancelScheduledValues(t);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value,t);
        voice.gain.gain.linearRampToValueAtTime(0,t+(immediate?.002:.009));
        voice.osc.stop(t+(immediate?.003:.012));
      } catch(_){}
    }
    updateKeyVisual(id);
  }
  function startVoice(id) {
    if(!ensureAudio())return;
    if(voices.has(id))stopVoice(id,true); // サステイン保持中に再打鍵→再発音
    const {oct,key}=noteFromId(id),freq=frequency(oct,key),now=context.currentTime;
    const osc=makeOscillator(freq,now),gain=context.createGain();
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(.13,now+.010);
    osc.connect(gain);gain.connect(master);
    osc.start(now);
    osc.onended=()=>{try{osc.disconnect();gain.disconnect();}catch(_){}};
    voices.set(id,{osc,gain,freq});
    attackEcho(freq,now);
    el('note-status').textContent=`${nameFor(oct,key)} · ${TONICS[state.tonic][0]} ${minorMode()?'短調':'長調'} · 比率 ${ratioFor(key)} · ${freq.toFixed(3)} Hz`;
    updateKeyVisual(id);
  }
  function updateKeyVisual(id){
    const elem=keyElements.get(id);if(elem)elem.classList.toggle('pressed',voices.has(id));
  }
  function hold(id) {
    const before=heldCounts.get(id)||0;
    heldCounts.set(id,before+1);
    if(before===0)startVoice(id);
  }
  function release(id) {
    const n=heldCounts.get(id)||0;
    if(n<=1){
      heldCounts.delete(id);
      if(!state.sustain)stopVoice(id);
    }else heldCounts.set(id,n-1);
  }
  function stopAll() {
    pointerNotes.clear();heldCounts.clear();
    for(const id of Array.from(voices.keys()))stopVoice(id,true);
    // 全消音では起音エコーも残さない（通常の鍵盤リリース時は従来どおり）。
    if(context){
      const now=context.currentTime;
      for(const node of Array.from(echoNodes)){
        try{
          node.gain.gain.cancelScheduledValues(now);
          node.gain.gain.setValueAtTime(0,now);
          node.osc.stop(now+.002);
        }catch(_){}
      }
    }
    echoNodes.clear();
    el('note-status').textContent='すべての音を停止';
  }
  function changeSustain(force) {
    state.sustain=typeof force==='boolean'?force:!state.sustain;
    if(!state.sustain)for(const id of Array.from(voices.keys()))if(!heldCounts.has(id))stopVoice(id);
    el('toggle-sustain').setAttribute('aria-pressed',String(state.sustain));
    el('toggle-sustain').querySelector('span').textContent=state.sustain?'ON':'OFF';
  }
  function renderTuning() {
    const container=el('tonic-grid');container.replaceChildren();
    TONICS.forEach(([name,ratio,minor],index)=>{
      const b=document.createElement('button');b.type='button';
      b.className='tonic-btn'+(minor?' minor':'')+(state.tonic===index?' active':'');
      b.textContent=name;b.setAttribute('aria-label',`${name}${minor?'短調':'長調'} ${ratio}`);
      b.setAttribute('aria-pressed',String(state.tonic===index));
      b.addEventListener('click',()=>{
        if(state.tonic===index)return;
        stopAll();state.tonic=index;renderTuning();updateUI();updateRatios();
      });container.appendChild(b);
    });
  }
  function createKey({id,left,width,top,height,kind,key,oct,center=false}){
    const div=document.createElement('div');
    div.className='play-key '+(kind==='white'?'white-key':'upper-key')+(kind==='gray'?' gray-key':'');
    // 上段と同化しやすい3か所の下段・中段の鍵だけを別の色にする。
    // E=C♯−1、Y=F♯−1、J=B（基準Cでの表示）。音名は移調後も切り替わる。
    if(kind==='black' && ['E','Y','J'].includes(key)) div.classList.add('lower-black-contrast');
    div.dataset.note=id;div.dataset.key=key;
    div.style.left=`${left}%`;div.style.width=`${width}%`;
    if(kind!=='white'){div.style.top=`${top}%`;div.style.height=`${height}%`;}
    div.setAttribute('role','button');div.setAttribute('aria-label',`第${oct+1}オクターブ、比率 ${ratioFor(key)}`);
    const note=document.createElement('span');note.className='key-note-name';
    note.textContent=nameFor(oct,key);
    const ratio=document.createElement('span');ratio.className='key-ratio';
    ratio.textContent=displayedRatio(oct,key);
    div.appendChild(note);div.appendChild(ratio);
    if(kind==='white'){
      const octlabel=document.createElement('span');octlabel.className='key-oct';
      octlabel.textContent=center?'Ⅰ→Ⅱ':(oct===0?'Ⅰ':'Ⅱ');
      div.appendChild(octlabel);
    }
    el('keyboard').appendChild(div);keyElements.set(id,div);
  }
  function renderKeyboard(){
    const area=el('keyboard');area.replaceChildren();keyElements.clear();
    const w=100/15;
    // 2オクターブ：15本の白鍵と、各オクターブ14本の上鍵＝43音。
    for(let position=0;position<=14;position++){
      // 15白鍵＝7 + 共通主音1 + 7。最後は上段の「,」＝4/1。
      // 7番目は下段の「,」と上段のZが同一音なので、上段Zとして1回だけ生成。
      const oct=position<7?0:1;
      const key=position<7?WHITES[position]:WHITES[position-7];
      createKey({id:idFor(oct,key),left:position*w,width:w,kind:'white',key,oct,center:position===7});
    }
    const marker=document.createElement('div');marker.className='octave-marker';area.appendChild(marker);
    for(let oct=0;oct<=1;oct++){
      for(let col=0;col<COLUMNS.length;col++){
        const keys=COLUMNS[col];
        const center=(oct*7+col+1)*w;
        // 史料の1オクターブ鍵盤図（IMG_0878）に基づく列ごとの寸法。
        // 全上鍵の上端は白鍵と同じ 0%。縦方向は途切れなく積み重ねる。
        // 3段：上 0–30.5%、中 30.5–45%、下 45–63.5%。
        // 2段：上 0–45%、下 45–63.5%。1段：上 0–30.5%。
        // 先のWeb版の 3〜4% の縦隙間、1段列の過剰な長さを解消。
        let specs=[];
        if(keys.length===3)specs=[['gray',45,18.5],['black',30.5,14.5],['black',0,30.5]];
        else if(keys.length===2)specs=[[keys[0]==='J'?'black':'gray',45,18.5],['black',0,45]];
        else specs=[['black',0,30.5]];
        keys.forEach((key,i)=>{
          const [kind,top,height]=specs[i],width=w*.94;
          createKey({id:idFor(oct,key),left:center-width/2,width,top,height,kind,key,oct});
        });
      }
    }
  }
  function updateRatios(){
    for(const [id,elem] of keyElements){
      const {oct,key}=noteFromId(id);
      const ratio=ratioFor(key),name=nameFor(oct,key);
      elem.querySelector('.key-ratio').textContent=displayedRatio(oct,key);
      elem.querySelector('.key-note-name').textContent=name;
      elem.setAttribute('aria-label',`第${oct+1}オクターブ、${name}、比率 ${displayedRatio(oct,key)}`);
      elem.classList.toggle('ratio-switched',ratio!==BASE[key]);
    }
  }
  function updateUI(){
    el('toggle-p').setAttribute('aria-pressed',String(state.p));
    el('toggle-o').setAttribute('aria-pressed',String(state.o));
    el('octave-text').textContent=(state.octave>=0?'+':'')+state.octave;
    el('mode-label').textContent=`${TONICS[state.tonic][0]} ${minorMode()?'短調':'長調'}`;
    el('tuning-value').textContent=`固定基準比 ${TONICS[state.tonic][1]}`;
  }
  function changeMode(which){stopAll();state[which]=!state[which];updateUI();updateRatios();}
  function octaveStep(n){
    const next=Math.max(MIN_SHIFT,Math.min(MAX_SHIFT,n));
    if(next!==state.octave){stopAll();state.octave=next;updateUI();}
  }
  function hitKeyAt(clientX,clientY){
    const item=document.elementFromPoint(clientX,clientY);
    const key=item&&item.closest?item.closest('.play-key'):null;
    if(!key||!el('keyboard').contains(key))return null;
    return key.dataset.note;
  }
  function installPointers(){
    const area=el('keyboard');
    area.addEventListener('pointerdown',e=>{
      const note=hitKeyAt(e.clientX,e.clientY);if(!note)return;
      e.preventDefault();
      // 鍵盤全体で指を追い、スライド中もキー移動を認識。
      try{area.setPointerCapture(e.pointerId);}catch(_){}
      pointerNotes.set(e.pointerId,note);hold(note);
    });
    area.addEventListener('pointermove',e=>{
      if(!pointerNotes.has(e.pointerId))return;
      e.preventDefault();
      const prev=pointerNotes.get(e.pointerId),next=hitKeyAt(e.clientX,e.clientY);
      if(prev===next)return;
      if(prev)release(prev);
      if(next)hold(next);
      pointerNotes.set(e.pointerId,next);
    });
    const up=e=>{
      if(!pointerNotes.has(e.pointerId))return;
      e.preventDefault();
      const note=pointerNotes.get(e.pointerId);if(note)release(note);
      pointerNotes.delete(e.pointerId);
    };
    area.addEventListener('pointerup',up);
    area.addEventListener('pointercancel',up);
    area.addEventListener('lostpointercapture',up);
  }
  el('sound-on').addEventListener('click',ensureAudio);
  el('toggle-p').addEventListener('click',()=>changeMode('p'));
  el('toggle-o').addEventListener('click',()=>changeMode('o'));
  el('toggle-sustain').addEventListener('click',()=>changeSustain());
  el('panic').addEventListener('click',()=>{stopAll();changeSustain(false);});
  el('octave-down').addEventListener('click',()=>octaveStep(state.octave-1));
  el('octave-up').addEventListener('click',()=>octaveStep(state.octave+1));
  el('octave-reset').addEventListener('click',()=>octaveStep(0));
  window.addEventListener('blur',()=>stopAll());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();});
  // iPad Safari: 複数指で弾いてもWebページ自体を拡大させない。
  // Web AudioやPointerEventによるマルチタッチ演奏には触れない。
  for (const eventName of ['gesturestart','gesturechange']) {
    document.addEventListener(eventName, event => {
      if (event.cancelable) event.preventDefault();
    }, {passive:false});
  }
  document.addEventListener('touchmove', event => {
    if (event.touches.length > 1 && event.cancelable) event.preventDefault();
  }, {passive:false});
  installPointers();renderTuning();renderKeyboard();updateUI();updateRatios();
  // GitHub Pages (HTTPS) 配置時のみ、舞台での回線途絶に備えて静的資材を保存。
  // 初回閲覧後、機内モードでの再起動テストが必要（キャッシュ動作は保証しない）。
  if('serviceWorker' in navigator && location.protocol==='https:') {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Offline cache:',err)));
  }
  // 開発者向け読み取り専用の比率検査（演奏時には使用しない）
  window.TanakaInspect=Object.freeze({
    tonics:()=>TONICS.map(x=>({label:x[0],ratio:x[1],minor:x[2]})),
    ratioFor:key=>ratioFor(key),displayedRatio:(oct,key)=>displayedRatio(oct,key),frequency:(oct,key)=>frequency(oct,key),
    state:()=>({...state}),activeVoices:()=>voices.size,whiteCount:()=>el('keyboard').querySelectorAll('.white-key').length,
    noteCount:()=>el('keyboard').querySelectorAll('.play-key').length
  });
})();
