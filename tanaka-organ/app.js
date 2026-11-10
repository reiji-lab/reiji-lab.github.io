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
  // G−1調（通常モード）で比率と照合済みの6音。ほかの調・P/Oには影響させない。
  const G_MINUS_ONE_CONFIRMED = Object.freeze({
    '125/81':'G♯−3',   // (20/27) × (25/24)  → オクターブ正規化
    '50/27':'H−2',     // (20/27) × (5/4)   → オクターブ正規化
    '250/243':'C♯−3', // (20/27) × (25/18)
    '125/108':'D♯−3', // (20/27) × (25/16)
    '125/96':'E♯−3',  // (20/27) × (225/128)
    '375/256':'F×−3'  // (20/27) × (2025/1024)
  });
  const CHROMATIC_GERMAN = ['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B','H'];
  // 12平均律用の移調板：シントニックコンマ補正表記や長短調の重複は不要。
  // 純正調の18調データは一切変更しない。各ボタンは従来の代表調を選ぶ。
  // ドイツ式音名 B=変ロ、H=ロ。
  const EDO_TONIC_CHOICES = [
    ['C',9],['D♭',10],['D',11],['E♭',13],['E',14],['F',16],
    ['F♯',17],['G',0],['A♭',2],['A',3],['B',6],['H',7]
  ];
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
    // この6音はG−1調の通常モードだけで確定。移調先全体には流用しない。
    if(state.tonic===0 && !state.p && !state.o &&
       Object.prototype.hasOwnProperty.call(G_MINUS_ONE_CONFIRMED,ratio)){
      return G_MINUS_ONE_CONFIRMED[ratio];
    }
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
  // 既存のC～C（白鍵15本）から、下へ合計7本分、上は5本分まで表示する。
  // 白鍵位置は元の下端Cを0、1オクターブ上を7、2オクターブ上を14とする。
  const LOW_WHITE_OFFSET = -7, HIGH_WHITE_OFFSET = 19;
  const WHITE_COUNT = HIGH_WHITE_OFFSET - LOW_WHITE_OFFSET + 1;
  const el = id => document.getElementById(id);
  const state = {tonic:9, p:false,o:false,octave:0,sustain:false,equal:false};
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
  // 12平均律ではC4=261.625565Hzを固定基準とする。
  // 18調は最も近い100セント単位へ写像し、すべての鍵間隔を厳密に2^(1/12)とする。
  const EDO_WHITE_SEMITONES = [0,2,4,5,7,9,11];
  const EDO_BLACK_AFTER = new Set([0,1,3,4,5]);
  function equalTonicSemitones(){
    return Math.round(12*Math.log2(parseRatio(TONICS[state.tonic][1])));
  }
  function equalWhiteSemitone(position){
    const octave=Math.floor(position/7);
    const index=((position%7)+7)%7;
    return octave*12+EDO_WHITE_SEMITONES[index];
  }
  function equalName(semitone){
    const n=((semitone+equalTonicSemitones())%12+12)%12;
    return CHROMATIC_GERMAN[n];
  }
  function equalCents(semitone){
    return `${semitone*100}¢`;
  }
  function equalFrequency(semitone){
    return BASE_FREQ*Math.pow(2,(equalTonicSemitones()+semitone+12*state.octave)/12);
  }
  // 鍵盤上の分数は選択された調の主音を1とした比率。
  // 拡張した下の音は÷2、3オクターブ目は×4。表示用の分数も正確に約分。
  // 調の主音基準の比率なので、移調操作だけでは分数は変えない。
  function displayedRatio(oct,key) {
    let [n,d]=ratioFor(key).split('/').map(Number);
    if(oct>0)n*=2**oct;
    else if(oct<0)d*=2**(-oct);
    const factor=gcd(n,d);
    return `${n/factor}/${d/factor}`;
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
    const edo=id.startsWith('edo:');
    const semitone=edo?Number(id.slice(4)):null;
    const {oct,key}=edo?{oct:null,key:null}:noteFromId(id);
    const freq=edo?equalFrequency(semitone):frequency(oct,key),now=context.currentTime;
    const osc=makeOscillator(freq,now),gain=context.createGain();
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(.13,now+.010);
    osc.connect(gain);gain.connect(master);
    osc.start(now);
    osc.onended=()=>{try{osc.disconnect();gain.disconnect();}catch(_){}};
    voices.set(id,{osc,gain,freq});
    attackEcho(freq,now);
    el('note-status').textContent=edo
      ? `${equalName(semitone)} · 12平均律 · 基準主音から ${equalCents(semitone)} · ${freq.toFixed(3)} Hz`
      : `${nameFor(oct,key)} · ${TONICS[state.tonic][0]} ${minorMode()?'短調':'長調'} · 比率 ${ratioFor(key)} · ${freq.toFixed(3)} Hz`;
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
    container.classList.toggle('equal-tonics',state.equal);
    if(state.equal){
      // 12平均律は1半音につき1個のボタン。選択中の純正調名の−1は表示しない。
      const active=((equalTonicSemitones()%12)+12)%12;
      EDO_TONIC_CHOICES.forEach(([name,tonicIndex],semitone)=>{
        const selected=semitone===active;
        const b=document.createElement('button');b.type='button';
        b.className='tonic-btn'+(selected?' active':'');
        b.textContent=name;
        b.setAttribute('aria-label',`${name}へ移調（12平均律）`);
        b.setAttribute('aria-pressed',String(selected));
        b.addEventListener('click',()=>{
          if(selected)return;
          stopAll();state.tonic=tonicIndex;renderTuning();updateUI();updateRatios();
        });container.appendChild(b);
      });
      return;
    }
    // 純正調は元の18調、長短調、−1補正の文字をすべて維持。
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
  const octaveLabel = oct => oct===-1?'低音拡張':oct===2?'高音拡張':`第${oct+1}オクターブ`;
  function createKey({id,left,width,top,height,kind,key,oct,center=false,upperCenter=false,edoSemi=null}){
    const isEqual=edoSemi!==null;
    const div=document.createElement('div');
    div.className='play-key '+(kind==='white'?'white-key':'upper-key')+(kind==='gray'?' gray-key':'')+(isEqual?' edo-piano-key':'');
    // 上段と同化しやすい3か所の下段・中段の鍵だけを別の色にする。
    // E=C♯−1、Y=F♯−1、J=B（基準Cでの表示）。音名は移調後も切り替わる。
    if(!isEqual && kind==='black' && ['E','Y','J'].includes(key)) div.classList.add('lower-black-contrast');
    div.dataset.note=id;if(!isEqual)div.dataset.key=key;
    div.style.left=`${left}%`;div.style.width=`${width}%`;
    if(kind!=='white'){div.style.top=`${top}%`;div.style.height=`${height}%`;}
    const pitch=isEqual?equalCents(edoSemi):displayedRatio(oct,key);
    const name=isEqual?equalName(edoSemi):nameFor(oct,key);
    div.setAttribute('role','button');
    div.setAttribute('aria-label',isEqual?`12平均律 ${name}、主音から${pitch}`:`${octaveLabel(oct)}、比率 ${pitch}`);
    const note=document.createElement('span');note.className='key-note-name';
    note.textContent=name;
    const ratio=document.createElement('span');ratio.className='key-ratio';
    ratio.textContent=pitch;
    div.appendChild(note);div.appendChild(ratio);
    if(kind==='white'){
      const octlabel=document.createElement('span');octlabel.className='key-oct';
      octlabel.textContent=center?'Ⅰ→Ⅱ':upperCenter?'Ⅱ→Ⅲ':oct===-1?'低':oct===2?'Ⅲ':oct===0?'Ⅰ':'Ⅱ';
      div.appendChild(octlabel);
    }
    el('keyboard').appendChild(div);keyElements.set(id,div);
  }
  function renderKeyboard(){
    const area=el('keyboard');area.replaceChildren();keyElements.clear();
    if(state.equal){renderEqualKeyboard();return;}
    const w=100/WHITE_COUNT;
    // 白鍵27本：元のC～C（15本）＋左にC・D・E・F・G・A・H（7本）＋右にD・E・F・G・A（5本）。
    for(let position=LOW_WHITE_OFFSET;position<=HIGH_WHITE_OFFSET;position++){
      // 既存の鍵IDは変更しない。下側だけoct=-1、上側だけoct=2を使用する。
      // 基準Cの2オクターブ上は従来通り1:','で一回だけ生成。
      let oct,key;
      if(position<0){oct=-1;key=WHITES[position+7];}
      else if(position<7){oct=0;key=WHITES[position];}
      else if(position<=14){oct=1;key=WHITES[position-7];}
      else {oct=2;key=WHITES[position-14];}
      createKey({
        id:idFor(oct,key),left:(position-LOW_WHITE_OFFSET)*w,width:w,
        kind:'white',key,oct,center:position===7,upperCenter:position===14
      });
    }
    // 各Cの左端を境界として表示（既存の中央境界も位置を補正）。
    for(const position of [0,7,14]){
      const marker=document.createElement('div');marker.className='octave-marker';
      marker.style.left=`${(position-LOW_WHITE_OFFSET)*w}%`;
      area.appendChild(marker);
    }
    // 上鍵の配列と高さは元の史料準拠設計を再利用する。
    // 左端は前のオクターブの後半2列、右端は次のオクターブの前半5列。
    for(let position=LOW_WHITE_OFFSET;position<HIGH_WHITE_OFFSET;position++){
      const oct=Math.floor(position/7);
      const col=((position%7)+7)%7;
      const keys=COLUMNS[col];
      const center=(position-LOW_WHITE_OFFSET+1)*w;
      // 3段：上 0–30.5%、中 30.5–45%、下 45–63.5%。
      // 2段：上 0–45%、下 45–63.5%。1段：E♯−2とH♯−2もD♯−2と同じ0–45%。
      let specs=[];
      if(keys.length===3)specs=[['gray',45,18.5],['black',30.5,14.5],['black',0,30.5]];
      else if(keys.length===2)specs=[[keys[0]==='J'?'black':'gray',45,18.5],['black',0,45]];
      else specs=[['black',0,45]];
      keys.forEach((key,i)=>{
        const [kind,top,height]=specs[i],width=w*.94;
        createKey({id:idFor(oct,key),left:center-width/2,width,top,height,kind,key,oct});
      });
    }
  }
  // 同じ27白鍵・同じC位置に12平均律46鍵を描く。
  // 黒鍵はC-D、D-E、F-G、G-A、A-Hの間だけに1本ずつ置く。
  function renderEqualKeyboard(){
    const area=el('keyboard');
    const w=100/WHITE_COUNT;
    for(let position=LOW_WHITE_OFFSET;position<=HIGH_WHITE_OFFSET;position++){
      const oct=Math.floor(position/7),semitone=equalWhiteSemitone(position);
      createKey({id:`edo:${semitone}`,left:(position-LOW_WHITE_OFFSET)*w,width:w,
        kind:'white',oct,edoSemi:semitone,center:position===7,upperCenter:position===14});
    }
    for(const position of [0,7,14]){
      const marker=document.createElement('div');marker.className='octave-marker';
      marker.style.left=`${(position-LOW_WHITE_OFFSET)*w}%`;
      area.appendChild(marker);
    }
    for(let position=LOW_WHITE_OFFSET;position<HIGH_WHITE_OFFSET;position++){
      const col=((position%7)+7)%7;
      if(!EDO_BLACK_AFTER.has(col))continue;
      const semitone=equalWhiteSemitone(position)+1;
      const width=w*.94,center=(position-LOW_WHITE_OFFSET+1)*w; // 純正調の上鍵と同じ横幅
      createKey({id:`edo:${semitone}`,left:center-width/2,width,top:0,height:60,
        kind:'black',oct:Math.floor(position/7),edoSemi:semitone});
    }
  }
  function updateRatios(){
    for(const [id,elem] of keyElements){
      if(id.startsWith('edo:')){
        const semitone=Number(id.slice(4)),name=equalName(semitone),pitch=equalCents(semitone);
        elem.querySelector('.key-ratio').textContent=pitch;
        elem.querySelector('.key-note-name').textContent=name;
        elem.setAttribute('aria-label',`12平均律 ${name}、主音から${pitch}`);
        elem.classList.remove('ratio-switched');
      }else{
        const {oct,key}=noteFromId(id);
        const ratio=ratioFor(key),name=nameFor(oct,key);
        elem.querySelector('.key-ratio').textContent=displayedRatio(oct,key);
        elem.querySelector('.key-note-name').textContent=name;
        elem.setAttribute('aria-label',`${octaveLabel(oct)}、${name}、比率 ${displayedRatio(oct,key)}`);
        elem.classList.toggle('ratio-switched',ratio!==BASE[key]);
      }
    }
  }
  function updateUI(){
    el('toggle-p').setAttribute('aria-pressed',String(state.p));
    el('toggle-o').setAttribute('aria-pressed',String(state.o));
    el('toggle-p').disabled=state.equal;
    el('toggle-o').disabled=state.equal;
    const toggle=el('toggle-tuning');
    toggle.setAttribute('aria-pressed',String(state.equal));
    toggle.setAttribute('aria-label',state.equal?'純正調に切り替える':'12平均律に切り替える');
    toggle.querySelector('.tuning-switch-name').textContent=state.equal?'純正調へ':'12平均律へ';
    toggle.querySelector('.tuning-switch-sub').textContent=state.equal?'戻す':'切り替え';
    el('octave-text').textContent=(state.octave>=0?'+':'')+state.octave;
    const tonicName=TONICS[state.tonic][0];
    if(state.equal){
      const nearest=((equalTonicSemitones()%12)+12)%12;
      el('mode-label').textContent=`${CHROMATIC_GERMAN[nearest]} · 12平均律`;
      el('tuning-value').textContent='C基準 261.625565Hz · 100¢刻み';
      el('mode-description').textContent='12平均律：12音の移調（100¢刻み） · P/Oは純正調専用';
      el('keyboard-mode-caption').textContent='12-TONE EQUAL TEMPERAMENT · 46 KEYS';
      el('instrument').setAttribute('aria-label','12平均律・白鍵27本・46鍵');
    }else{
      el('mode-label').textContent=`${tonicName} ${minorMode()?'短調':'長調'}`;
      el('tuning-value').textContent=`固定基準比 ${TONICS[state.tonic][1]}`;
      el('mode-description').textContent='18の固定調名から選択 · 調名を押すと移調 · 鍵盤の比率は調の主音基準';
      el('keyboard-mode-caption').textContent='JUST INTONATION · EXTENDED 80 KEYS';
      el('instrument').setAttribute('aria-label','純正調・白鍵27本・80鍵');
    }
  }
  function changeTuning(){
    stopAll();
    state.equal=!state.equal;
    renderTuning();renderKeyboard();updateUI();updateRatios();
    el('note-status').textContent=state.equal?'12平均律に切替（100¢刻み）':'純正調に戻しました';
  }
  function changeMode(which){if(state.equal)return;stopAll();state[which]=!state[which];updateUI();updateRatios();}
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
    // Windowsのタッチパネルで長押しが右クリック扱いになる場合への対策。
    // 鍵盤内だけでブラウザ標準の右クリックメニューを禁止する（他のUIはそのまま）。
    area.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();});
    area.addEventListener('selectstart',e=>e.preventDefault());
    area.addEventListener('dragstart',e=>e.preventDefault());
    // タッチ長押しの既定動作を抑え、PointerEventでの演奏を継続する。
    area.addEventListener('touchstart',e=>{
      if(e.cancelable)e.preventDefault();
    },{passive:false});
    area.addEventListener('pointerdown',e=>{
      // マウスの右クリック・中クリックは発音に使わない。
      if(e.pointerType==='mouse' && e.button!==0)return;
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
  el('toggle-tuning').addEventListener('click',changeTuning);
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
    noteCount:()=>el('keyboard').querySelectorAll('.play-key').length,
    equalTonicSemitones:()=>equalTonicSemitones(),equalFrequency:semitone=>equalFrequency(semitone),
    equalWhiteSemitone:position=>equalWhiteSemitone(position)
  });
})();
