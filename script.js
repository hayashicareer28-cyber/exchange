/* GW Exchange Engine — browser global GWEngine / CommonJS.
 * plan([counts, counts]) accepts all nine denomination keys with integer counts.
 * Each register result contains input, total, exchange:{out,in,amount},
 * afterExchange, final, finalTotal, warnings and belowReserve.
 * All count maps contain all nine keys. Exchange preserves each register's
 * original value. Depositing money and moving money between registers are out
 * of scope. Count ranges are soft targets; valid cash accounting is mandatory.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GWEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DENOMS = Object.freeze([10000, 5000, 1000, 500, 100, 50, 10, 5, 1]);
  const SMALL = [100, 50, 10, 5, 1];
  const NOTES = [10000, 5000, 1000];
  const TARGETS = Object.freeze({
    5000: Object.freeze([10, 12]), 1000: Object.freeze([38, 42]),
    500: Object.freeze([14, 18]), 100: Object.freeze([40, 65]),
    50: Object.freeze([40, 65]), 10: Object.freeze([40, 65]),
    5: Object.freeze([40, 65]), 1: Object.freeze([40, 65])
  });
  const DEFAULT_SETTINGS = Object.freeze({targets: TARGETS, coinThreshold: 80, reserveAmount: 100000});
  function validateSettings(settings) {
    const source = settings === undefined ? DEFAULT_SETTINGS : settings;
    if (!source || typeof source !== 'object' || Array.isArray(source) || !source.targets || typeof source.targets !== 'object') throw new Error('設定の形式を確認してください。');
    const targets = {};
    for (const d of [5000, 1000, 500, ...SMALL]) {
      const bounds = source.targets[d];
      if (!Array.isArray(bounds) || bounds.length !== 2 || bounds.some(n => !Number.isSafeInteger(n) || n < 0 || n > 500) || bounds[0] > bounds[1]) throw new Error(`${d.toLocaleString('ja-JP')}円の目安は、0〜500枚で下限以下にならない上限を設定してください。`);
      targets[d] = [...bounds];
    }
    if (!Number.isSafeInteger(source.coinThreshold) || source.coinThreshold < 0 || source.coinThreshold > 1000) throw new Error('小銭の両替判定枚数は0〜1,000枚の整数で設定してください。');
    if (!Number.isSafeInteger(source.reserveAmount) || source.reserveAmount < 0 || source.reserveAmount > 10000000) throw new Error('準備金の目安は0〜10,000,000円の整数で設定してください。');
    return {targets, coinThreshold: source.coinThreshold, reserveAmount: source.reserveAmount};
  }
  function scoreWeights(settings) {
    const original = {5000:76,1000:20,500:76,100:19,50:19,10:19,5:19,1:19};
    return Object.fromEntries(Object.keys(TARGETS).map(d => [d, settings.targets[d][0] ? Math.round(original[d] * TARGETS[d][0] * 1000 / settings.targets[d][0]) : 0]));
  }
  const blank = () => Object.fromEntries(DENOMS.map(d => [d, 0]));
  const clone = c => Object.fromEntries(DENOMS.map(d => [d, c[d]]));
  const sum = c => DENOMS.reduce((s, d) => s + d * c[d], 0);
  const mod = (n, m) => ((n % m) + m) % m;
  const count = c => DENOMS.reduce((s, d) => s + c[d], 0);
  function better(a, b) {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }
  function validateInput(registers) {
    if (!Array.isArray(registers) || registers.length !== 2) {
      throw new Error('1レジ・2レジの2つの入力が必要です。');
    }
    return registers.map((source, i) => {
      if (!source || typeof source !== 'object') throw new Error(`${i + 1}レジの入力を確認してください。`);
      const c = blank();
      for (const d of DENOMS) {
        const n = source[d];
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 100000) {
          throw new Error(`${i + 1}レジの${d.toLocaleString('ja-JP')}円は、0〜100,000枚の整数で入力してください。`);
        }
        c[d] = n;
      }
      if (sum(c) > 10000000) throw new Error(`${i + 1}レジの合計は10,000,000円以下で入力してください。`);
      return c;
    });
  }
  // Enumerate useful note-count boundaries. For fixed 5,000-yen count, the
  // 1,000-yen count has a fixed remainder modulo ten. All score breakpoints
  // (target bounds and existing counts) and both adjacent values are tested.
  function chooseNotes(input, coinCost, settings, weights) {
    const targets = settings.targets;
    const units = (NOTES.reduce((s, d) => s + d * input[d], 0) - coinCost) / 1000;
    if (units < 0 || !Number.isInteger(units)) return null;
    const fives = new Set();
    const maxFive = Math.floor(units / 5);
    const anchors = [0, ...targets[5000], input[5000], maxFive,
      Math.floor((units - input[1000]) / 5), ...targets[1000].map(n => Math.floor((units - n) / 5)),
      Math.floor((units - input[1000] - input[10000] * 10) / 5)];
    for (const a of anchors) for (let shift = -2; shift <= 2; shift++) {
      const f = a + shift;
      if (f >= 0 && f <= maxFive) fives.add(f);
    }
    let best = null;
    for (const f of fives) {
      const remainder = units - 5 * f;
      const residue = mod(remainder, 10);
      const ones = new Set();
      for (const a of [0, ...targets[1000], input[1000], remainder, remainder - 10 * input[10000]]) {
        const below = Math.floor((a - residue) / 10) * 10 + residue;
        for (const o of [below, below + 10]) if (o >= 0 && o <= remainder) ones.add(o);
      }
      for (const o of ones) {
        const t = (remainder - o) / 10;
        const outT = Math.max(0,input[10000]-t), outF = Math.max(0,input[5000]-f), outO = Math.max(0,input[1000]-o);
        const shortage = Math.max(0, targets[5000][0] - f) * weights[5000] + Math.max(0, targets[1000][0] - o) * weights[1000];
        const newExcess = Math.max(0, f - targets[5000][1]) + Math.max(0, o - targets[1000][1]);
        const rank = [shortage, newExcess, outT*10000+outF*5000+outO*1000, outT+outF+outO,
          Math.max(0,t-input[10000])+Math.max(0,f-input[5000])+Math.max(0,o-input[1000])];
        if (better(rank, best && best.rank)) best = {target:{10000:t,5000:f,1000:o},shortage,newExcess,rank};
      }
    }
    if (best) {
      best.out = blank(); best.incoming = blank();
      for (const d of NOTES) { best.out[d] = Math.max(0,input[d]-best.target[d]); best.incoming[d] = Math.max(0,best.target[d]-input[d]); }
    }
    return best;
  }
  // Bounded coin DP stores the best deficit / main excess / piece count for
  // each 50-yen cost. The cap depends on target quantities, not register cash.
  // This supports up to 500 target coins without exponential enumeration.
  function coinCandidates(input, eligible, settings, weights, budget) {
    const onesWidth=settings.targets[1000][1]-settings.targets[1000][0];
    const fivesWidth=settings.targets[5000][1]-settings.targets[5000][0];
    const narrowNotes=onesWidth<9 && (onesWidth<4 || fivesWidth<1);
    // Tight note ranges can require matching a 10,000-yen remainder rather
    // than just a 1,000-yen remainder. Extra rolls remain drawer surplus.
    const padding = narrowNotes ? {100:1,50:3,10:19,5:39,1:199} : {100:0,50:1,10:1,5:3,1:19};
    const stages = [500,...SMALL].map(d => {
      const unit = d === 500 ? 1 : 50;
      const needed = Math.ceil(Math.max(0,settings.targets[d][0]-input[d])/unit);
      const limit = d === 500 ? Math.max(needed+1,settings.targets[500][1]-input[500]) : eligible[d] ? needed+padding[d] : 0;
      return {d,unit,step:d*unit/50,limit};
    });
    const cap = Math.min(Math.floor(budget/50),stages.reduce((s,t)=>s+t.step*t.limit,0));
    let deficit = new Float64Array(cap+1); deficit.fill(Infinity); deficit[0]=0;
    let excess = new Float64Array(cap+1), pieces = new Int32Array(cap+1);
    const history = [];
    for (const stage of stages) {
      const nextD = new Float64Array(cap+1); nextD.fill(Infinity);
      const nextE = new Float64Array(cap+1), nextP = new Int32Array(cap+1), choice = new Int16Array(cap+1);
      for (let amount=0;amount<=cap;amount++) {
        if (!Number.isFinite(deficit[amount])) continue;
        const maxQ = Math.min(stage.limit,Math.floor((cap-amount)/stage.step));
        for (let q=0;q<=maxQ;q++) {
          const to = amount+q*stage.step, finalCount=input[stage.d]+q*stage.unit;
          const d = deficit[amount]+Math.max(0,settings.targets[stage.d][0]-finalCount)*weights[stage.d];
          const e = excess[amount]+(stage.d===500 ? Math.max(0,finalCount-settings.targets[500][1]) : 0);
          const p = pieces[amount]+q*stage.unit;
          if (d<nextD[to] || (d===nextD[to] && (e<nextE[to] || (e===nextE[to] && p<nextP[to])))) {
            nextD[to]=d;nextE[to]=e;nextP[to]=p;choice[to]=q;
          }
        }
      }
      deficit=nextD;excess=nextE;pieces=nextP;history.push(choice);
    }
    return {cap,deficit,excess,pieces,stages,history};
  }
  function planRegister(input, eligibility, index, settings) {
    const targets=settings.targets, weights=scoreWeights(settings);
    const total = sum(input);
    const eligible = Object.fromEntries(eligibility.map(e => [e.denom,e.eligible]));
    const budget=NOTES.reduce((s,d)=>s+d*input[d],0);
    const coins=coinCandidates(input,eligible,settings,weights,budget);
    let best=null;
    for (let amount=0;amount<=coins.cap;amount+=20) {
      if (!Number.isFinite(coins.deficit[amount])) continue;
      const notes=chooseNotes(input,amount*50,settings,weights);
      if (!notes) continue;
      const rank=[notes.shortage+coins.deficit[amount],notes.newExcess+coins.excess[amount],notes.rank[2],coins.pieces[amount],notes.rank[3],notes.rank[4]];
      if (better(rank,best&&best.rank)) best={notes,amount,rank};
    }
    const receipts=blank();
    let remainder=best.amount;
    for (let i=coins.stages.length-1;i>=0;i--) {
      const stage=coins.stages[i],q=coins.history[i][remainder];
      receipts[stage.d]=q*stage.unit;remainder-=q*stage.step;
    }
    best.receipts=receipts;
    const outgoing = clone(best.notes.out), incoming = clone(best.notes.incoming);
    for (const d of [500, ...SMALL]) incoming[d] += best.receipts[d];
    const final = blank();
    for (const d of DENOMS) final[d] = input[d] - outgoing[d] + incoming[d];
    const warnings = [];
    for (const d of [5000, 1000, 500, ...SMALL]) {
      if (final[d] < targets[d][0]) {
        const exclusion = d <= 100 && !eligible[d] ? `（2レジ合計が${settings.coinThreshold}枚を超えるため、外部両替の対象外）` : '';
        warnings.push(`${d.toLocaleString('ja-JP')}円は${final[d]}枚で、目安の下限${targets[d][0]}枚に${targets[d][0] - final[d]}枚不足しています${exclusion}。`);
      }
    }
    if ([5000, 1000, 500].some(d => final[d] > targets[d][1])) warnings.push('お札または500円玉が目安の上限を超えています。上限は厳密な制限ではありません。');
    if (SMALL.some(d => final[d] > targets[d][1])) warnings.push('100円以下の小銭で設定した目安の上限を超えた分は、ドロアに保管できます。余剰分もレジの合計金額に含めています。');
    if (total < settings.reserveAmount) warnings.push(`合計は準備金の目安${settings.reserveAmount.toLocaleString('ja-JP')}円より${(settings.reserveAmount - total).toLocaleString('ja-JP')}円少ない状態です。両替では合計金額は増えません。`);
    return {name: `${index + 1}レジ`, input: clone(input), total,
      exchange: {out: outgoing, in: incoming, amount: sum(outgoing)},
      afterExchange: clone(final), final: clone(final), finalTotal: sum(final),
      belowReserve: total < settings.reserveAmount, warnings};
  }
  function validatePlan(result) {
    const errors = [];
    if (!result || !Array.isArray(result.registers) || result.registers.length !== 2) return {valid: false, errors: ['レジ数が不正です。']};
    let settings;
    try { settings=validateSettings(result.settings); } catch(e) { return {valid:false,errors:[e.message]}; }
    result.registers.forEach((r, i) => {
      const label = `${i + 1}レジ`;
      for (const c of [r.input, r.exchange.out, r.exchange.in, r.afterExchange, r.final]) {
        for (const d of DENOMS) if (!Number.isSafeInteger(c[d]) || c[d] < 0) errors.push(`${label}: ${d}円の枚数が不正です。`);
      }
      for (const d of DENOMS) {
        if (r.exchange.out[d] > r.input[d]) errors.push(`${label}: 手元にない現金を取り出しています。`);
        if (d < 1000 && r.exchange.out[d]) errors.push(`${label}: 小銭を両替用に取り出しています。`);
        if (d <= 100 && r.exchange.in[d] % 50) errors.push(`${label}: 棒金単位になっていません。`);
        if (d <= 100 && r.exchange.in[d] && result.registers[0].input[d] + result.registers[1].input[d] > settings.coinThreshold) errors.push(`${label}: 対象外の小銭を受け取っています。`);
        if (r.input[d] - r.exchange.out[d] + r.exchange.in[d] !== r.final[d] || r.final[d] !== r.afterExchange[d]) errors.push(`${label}: 残枚数が一致しません。`);
      }
      if (sum(r.exchange.out) !== sum(r.exchange.in) || sum(r.exchange.out) !== r.exchange.amount) errors.push(`${label}: 両替の収支が一致しません。`);
      if (sum(r.input) !== sum(r.final) || sum(r.input) !== r.total || sum(r.final) !== r.finalTotal) errors.push(`${label}: 合計金額が変化しています。`);
    });
    return {valid: errors.length === 0, errors};
  }
  function plan(registers, suppliedSettings) {
    const settings=validateSettings(suppliedSettings);
    const inputs = validateInput(registers);
    const eligibility = SMALL.map(denom => ({denom, total: inputs[0][denom] + inputs[1][denom], eligible: inputs[0][denom] + inputs[1][denom] <= settings.coinThreshold}));
    const result = {settings,eligibility, registers: inputs.map((input, i) => planRegister(input, eligibility, i,settings)), warnings: []};
    const check = validatePlan(result);
    if (!check.valid) throw new Error(`計算結果の検証に失敗しました。${check.errors.join(' ')}`);
    return result;
  }
  return Object.freeze({DENOMS, TARGETS, DEFAULT_SETTINGS, validateSettings, sum, plan, validatePlan});
});


(function () {
  'use strict';
  const KEY = 'gw-exchange-settings-v1';
  const E = window.GWEngine;
  const D = [5000,1000,500,100,50,10,5,1];
  const $ = id => document.getElementById(id);
  const label = d => Number(d).toLocaleString('ja-JP')+'円'+(d>=1000?'札':'玉');
  let current = E.validateSettings(E.DEFAULT_SETTINGS);
  let loadError = '';
  let dirty = false;
  function load() {
    try {
      const saved=localStorage.getItem(KEY);
      current=E.validateSettings(saved===null?E.DEFAULT_SETTINGS:JSON.parse(saved));
      loadError='';
    } catch (_) {
      current=E.validateSettings(E.DEFAULT_SETTINGS);
      loadError='保存した設定を読み込めないため、初期設定を使用しています。「設定」で確認してください。';
    }
  }
  function get() { return E.validateSettings(current); }
  function announceChange() { window.dispatchEvent(new CustomEvent('gw-settings-changed')); }
  function showLoadError() {
    $('settings-read-error').textContent=loadError;
    $('settings-read-error').hidden=!loadError;
  }
  function sameAsDefault() { return JSON.stringify(current)===JSON.stringify(E.validateSettings(E.DEFAULT_SETTINGS)); }
  function fill(settings) {
    D.forEach(d=>[0,1].forEach(i=>{$('target-'+d+'-'+i).value=settings.targets[d][i];}));
    $('coin-threshold').value=settings.coinThreshold;
    $('reserve-amount').value=settings.reserveAmount;
    $('settings-form').querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
    $('settings-errors').hidden=true;
    dirty=false;
  }
  function readForm() {
    const errors=[];
    const read=(id,name,max)=>{
      const el=$(id);
      const raw=el.value.trim().replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248));
      const valid=/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)<=max;
      el.setAttribute('aria-invalid',valid?'false':'true');
      if(!valid)errors.push(name+'は0〜'+max.toLocaleString('ja-JP')+'の整数で入力してください。');
      return valid?Number(raw):0;
    };
    const targets={};
    D.forEach(d=>{
      const low=read('target-'+d+'-0',label(d)+'の下限',500);
      const high=read('target-'+d+'-1',label(d)+'の上限',500);
      targets[d]=[low,high];
      if(low>high){errors.push(label(d)+'は下限が上限以下になるようにしてください。');$('target-'+d+'-0').setAttribute('aria-invalid','true');}
    });
    const settings={targets,coinThreshold:read('coin-threshold','2レジ合計の上限枚数',1000),reserveAmount:read('reserve-amount','準備金の目安',10000000)};
    if(errors.length)throw new Error(errors.join('\n'));
    return E.validateSettings(settings);
  }
  function route() {
    const settingsPage=location.hash==='#settings';
    $('exchange-page').hidden=settingsPage;
    $('settings-page').hidden=!settingsPage;
    document.querySelectorAll('[data-view]').forEach(el=>{
      const active=el.dataset.view===(settingsPage?'settings':'exchange');
      el.classList.toggle('active',active);
      if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
    });
    if(settingsPage){fill(current);$('settings-status').textContent='変更後に「保存して戻る」を押すと、次の両替計算に反映されます。';$('settings-title').focus({preventScroll:true});window.scrollTo(0,0);}
    else {window.scrollTo(0,0);}
  }
  function init() {
    $('settings-targets').innerHTML=D.map(d=>'<tr><th scope="row">'+label(d)+'</th>'+[0,1].map(i=>'<td><label class="sr-only" for="target-'+d+'-'+i+'">'+label(d)+'の'+(i?'上限':'下限')+'</label><input class="settings-number" id="target-'+d+'-'+i+'" type="text" inputmode="numeric" maxlength="3" autocomplete="off" required><span class="settings-unit">枚</span></td>').join('')+'</tr>').join('');
    showLoadError();fill(current);
    $('settings-form').addEventListener('input',()=>{dirty=true;$('settings-status').textContent='変更はまだ保存されていません。';$('settings-errors').hidden=true;});
    $('settings-form').addEventListener('submit',e=>{
      e.preventDefault();
      try {
        const next=readForm();
        try {localStorage.setItem(KEY,JSON.stringify(next));}catch(_){throw new Error('このブラウザーでは設定を保存できませんでした。設定は変更していません。');}
        current=next;loadError='';showLoadError();dirty=false;
        announceChange();location.hash='exchange';
        $('settings-summary').textContent='設定を保存しました。次の計算から適用します。';
      } catch(error) {
        $('settings-errors').textContent=error.message;$('settings-errors').hidden=false;
        const invalid=$('settings-form').querySelector('[aria-invalid="true"]');
        if(invalid)invalid.focus();else $('settings-errors').scrollIntoView({block:'center'});
      }
    });
    $('settings-defaults').addEventListener('click',()=>{fill(E.validateSettings(E.DEFAULT_SETTINGS));dirty=true;$('settings-status').textContent='初期値を入力しました。「保存して戻る」で適用してください。';});
    $('settings-cancel').addEventListener('click',()=>{fill(current);location.hash='exchange';});
    window.addEventListener('hashchange',route);
    window.addEventListener('storage',e=>{
      if(e.key!==KEY&&e.key!==null)return;
      load();showLoadError();announceChange();
      if(!dirty)fill(current);
      else $('settings-status').textContent='別の画面で設定が変更されました。編集中の値を保存すると、そちらを上書きします。';
    });
    route();
  }
  load();
  window.GWSettings=Object.freeze({get,sameAsDefault});
  try{init();}catch(error){$('startup-warning').textContent='設定画面を準備できませんでした。'+error.message;}
})();

(function () {
  'use strict';
  const D = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];
  let currentSettings = window.GWSettings.get();
  let TARGETS = currentSettings.targets;
  const STORAGE = 'gw-exchange-v20261001';
  const yen = n => new Intl.NumberFormat('ja-JP').format(n) + '円';
  const num = n => new Intl.NumberFormat('ja-JP').format(n);
  const label = d => yen(d) + (d >= 1000 ? '札' : '玉');
  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let lastPlan = null;
  let lastText = '';
  let isSample = false;
  let savedTimer;
  function values() { return [0,1].map(r => Object.fromEntries(D.map(d => [d, $('r'+r+'-'+d).value.trim()]))); }
  function normalized(s) { return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0)-65248)); }
  function total(c) { return D.reduce((s,d) => s + d * Number(c[d] || 0), 0); }
  function parse(raw) {
    const errors=[];
    const registers=raw.map((r,i)=>Object.fromEntries(D.map(d=>{
      const s=normalized(r[d]);
      const valid=/^\d+$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s)<=100000;
      $('r'+i+'-'+d).setAttribute('aria-invalid', valid?'false':'true');
      if(!valid) errors.push((i+1)+'レジの'+label(d)+'は0〜100,000の整数を入力してください。');
      return [d,valid?Number(s):0];
    })));
    registers.forEach((r,i)=>{if(total(r)>10000000) errors.push((i+1)+'レジの合計が上限の1,000万円を超えています。');});
    return {registers,errors};
  }
  function updateTotals() {
    const raw=values();
    raw.forEach((r,i)=>{
      const filled=D.every(d=>/^\d+$/.test(normalized(r[d])));
      const sum=total(Object.fromEntries(D.map(d=>[d,/^\d+$/.test(normalized(r[d]))?Number(normalized(r[d])):0])));
      $('r'+(i+1)+'-total').textContent=yen(sum);
      const status=$('r'+(i+1)+'-status');
      const reserve=currentSettings.reserveAmount;
      status.textContent=!filled?'すべての金種を入力':sum<reserve?'準備金の目安まで '+yen(reserve-sum):sum===reserve?'準備金の目安と一致':'準備金の目安 ＋'+yen(sum-reserve);
      status.className=filled&&sum>=reserve?'status-good':'status-warn';
    });
  }
  function saveDraft() {
    try {
      localStorage.setItem(STORAGE,JSON.stringify({registers:values(),isSample}));
      $('save-status').textContent=isSample?'サンプル入力中 · 実際の計算は「入力クリア」から開始':'この端末に入力内容を保存しました';
    } catch (_) { $('save-status').textContent='この環境では保存できません。画面を閉じる前に結果を控えてください。'; }
  }
  function invalidate() {
    if(lastPlan){$('results').hidden=true;$('empty-state').hidden=false;$('empty-state').textContent='入力が変わりました。「両替プランを作成」で計算し直してください。';}
    lastPlan=null;lastText='';
    $('input-errors').hidden=true;
    updateTotals();clearTimeout(savedTimer);savedTimer=setTimeout(saveDraft,250);
  }
  function list(counts, bank) {
    const items=D.filter(d=>counts[d]>0).map(d=>'<li><span>'+label(d)+'</span><strong>'+num(counts[d])+'枚'+(bank&&d<=100?' <small>（棒金'+num(counts[d]/50)+'本）</small>':'')+'</strong></li>');
    return items.length?'<ul class="denomination-list">'+items.join('')+'</ul>':'<p class="muted">なし</p>';
  }
  function countsText(counts,bank) { return D.filter(d=>counts[d]>0).map(d=>label(d)+' '+num(counts[d])+'枚'+(bank&&d<=100?'（棒金'+num(counts[d]/50)+'本）':'')).join('、')||'なし'; }
  function makeText(plan) {
    const lines=isSample?['【サンプル結果】']:[];
    plan.registers.forEach((r,i)=>{
      lines.push('',(i+1)+'レジ');
      if(r.exchange.amount===0){lines.push('両替なし');return;}
      lines.push('取り出すお札：'+countsText(r.exchange.out,false),'両替して受け取る：'+countsText(r.exchange.in,true));
    });
    return lines.join('\n').trim();
  }
  function render(plan) {
    $('result-status').textContent='各レジの両替手順を作成しました。';
    const cards=plan.registers.map((r,i)=>{
      const heading='<div class="result-card-heading"><h3>'+(i+1)+'レジ'+(isSample?' <small>（サンプル）</small>':'')+'</h3></div>';
      if(r.exchange.amount===0)return '<article class="result-card">'+heading+'<p class="muted">両替なし</p></article>';
      return '<article class="result-card">'+heading+'<div class="instruction"><h4><span class="step-number">1</span> このレジから取り出すお札</h4>'+list(r.exchange.out,false)+'</div><div class="instruction"><h4><span class="step-number">2</span> 両替して受け取る</h4>'+list(r.exchange.in,true)+'</div></article>';
    }).join('');
    $('result-content').innerHTML='<div class="result-grid">'+cards+'</div>';
    $('empty-state').hidden=true;$('results').hidden=false;
    lastText=makeText(plan);
    $('results').scrollIntoView({behavior:'smooth',block:'start'});
    $('result-status').setAttribute('tabindex','-1');$('result-status').focus({preventScroll:true});
  }
  function assertPlan(plan) {
    plan.registers.forEach(r=>{
      D.forEach(d=>{
        [r.input,r.exchange.out,r.exchange.in,r.afterExchange,r.final].forEach(c=>{if(!Number.isSafeInteger(c[d])||c[d]<0)throw Error('計算中に不正な枚数が見つかりました。');});
        if(r.exchange.out[d]>r.input[d]||(d<1000&&r.exchange.out[d]!==0))throw Error('両替に出すお札の検証に失敗しました。');
        if(d<=100&&r.exchange.in[d]>0&&(r.exchange.in[d]%50!==0||!plan.eligibility.find(e=>e.denom===d).eligible))throw Error('棒金の条件を確認できませんでした。');
        if(r.input[d]-r.exchange.out[d]+r.exchange.in[d]!==r.afterExchange[d]||r.afterExchange[d]!==r.final[d])throw Error('枚数の収支を確認できませんでした。');
      });
      if(total(r.exchange.in)!==total(r.exchange.out)||total(r.input)!==total(r.afterExchange)||total(r.final)!==r.finalTotal||r.finalTotal!==r.total)throw Error('金額の収支を確認できませんでした。');
    });
  }
  function refreshSettingsLabels() {
    document.querySelectorAll('#cash-inputs .target-cell').forEach((cell,i)=>{const range=TARGETS[D[i]];cell.textContent=range?range[0]+'〜'+range[1]+'枚':'指定なし';});
    $('help-targets').innerHTML=D.filter(d=>TARGETS[d]).map(d=>'<tr><td>'+label(d)+'</td><td>'+TARGETS[d][0]+'〜'+TARGETS[d][1]+'枚</td></tr>').join('');
    $('help-coin-threshold').textContent=currentSettings.coinThreshold;
    $('help-coin-excluded').textContent=currentSettings.coinThreshold+1;
    $('help-reserve-label').textContent=yen(currentSettings.reserveAmount);
    $('settings-summary').textContent=window.GWSettings.sameAsDefault()?'初期設定で計算します。':'保存した設定で計算します。';
  }
  function init() {
    if(!window.GWEngine)throw Error('計算用プログラムを読み込めませんでした。ファイル一式を同じフォルダーに置いてください。');
    $('cash-inputs').innerHTML=D.map(d=>'<tr><th scope="row"><span class="denom-label">'+yen(d)+'</span><small>'+(d>=1000?'紙幣':d===500?'硬貨':'硬貨 · 棒金50枚')+'</small></th>'+[0,1].map(r=>'<td><label class="sr-only" for="r'+r+'-'+d+'">'+(r+1)+'レジの'+label(d)+'の枚数</label><div class="count-field"><input class="count-input" id="r'+r+'-'+d+'" type="text" inputmode="numeric" pattern="[0-9０-９]*" autocomplete="off" maxlength="6" placeholder="0" required aria-describedby="input-hint"><span>枚</span></div></td>').join('')+'<td class="target-cell">'+(TARGETS[d]?TARGETS[d][0]+'〜'+TARGETS[d][1]+'枚':'指定なし')+'</td></tr>').join('');
    try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved&&Array.isArray(saved.registers)&&saved.registers.length===2){saved.registers.forEach((r,i)=>D.forEach(d=>{$('r'+i+'-'+d).value=typeof r[d]==='string'?r[d]:'';}));isSample=Boolean(saved.isSample);$('save-status').textContent=isSample?'サンプル入力中 · 実際の計算は「入力クリア」から開始':'この端末に保存した入力を復元しました';}}catch(_){$('save-status').textContent='入力内容の自動保存は利用できません。';}
    if($('today-label'))$('today-label').textContent=new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
    $('cash-form').noValidate=true;
    $('cash-form').addEventListener('input',e=>{if(e.target.matches('input')){e.target.removeAttribute('aria-invalid');invalidate();}});
    $('sample-button').addEventListener('click',()=>{
      const sample=[{10000:6,5000:7,1000:12,500:6,100:35,50:30,10:35,5:25,1:30},{10000:5,5000:8,1000:16,500:8,100:40,50:40,10:40,5:30,1:30}];
      sample.forEach((r,i)=>D.forEach(d=>{const field=$('r'+i+'-'+d);field.value=r[d];field.removeAttribute('aria-invalid');}));isSample=true;invalidate();saveDraft();
    });
    $('reset-button').addEventListener('click',()=>{D.forEach(d=>[0,1].forEach(r=>{const field=$('r'+r+'-'+d);field.value='';field.removeAttribute('aria-invalid');}));isSample=false;invalidate();saveDraft();$('r0-10000').focus();});
    $('cash-form').addEventListener('submit',async e=>{
      e.preventDefault();
      const p=parse(values());
      if(p.errors.length){$('input-errors').innerHTML='<strong>入力を確認してください</strong><ul>'+p.errors.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';$('input-errors').hidden=false;document.querySelector('[aria-invalid="true"]')?.focus();return;}
      const button=$('calculate-button');button.disabled=true;button.textContent='計算しています…';$('input-errors').hidden=true;
      await new Promise(resolve=>setTimeout(resolve,20));
      try{const plan=window.GWEngine.plan(p.registers,currentSettings);assertPlan(plan);lastPlan=plan;render(plan);saveDraft();}catch(error){lastPlan=null;lastText='';$('results').hidden=true;$('input-errors').textContent='計算できませんでした。'+error.message;$('input-errors').hidden=false;$('input-errors').scrollIntoView({block:'center'});}finally{button.disabled=false;button.textContent='両替プランを作成';}
    });
    $('copy-button').addEventListener('click',async()=>{
      if(!lastText)return;
      try{await navigator.clipboard.writeText(lastText);$('copy-button').textContent='コピーしました';setTimeout(()=>$('copy-button').textContent='結果をコピー',1800);}catch(_){const dialog=document.createElement('dialog');dialog.className='copy-dialog';dialog.innerHTML='<h2>結果をコピー</h2><p>下の文章をすべて選択してコピーしてください。</p><textarea rows="16" aria-label="計算結果"></textarea><form method="dialog"><button class="button secondary">閉じる</button></form>';document.body.append(dialog);dialog.querySelector('textarea').value=lastText;dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();dialog.querySelector('textarea').select();}
    });
    $('print-button').addEventListener('click',()=>{if(lastPlan)window.print();});
    let collapsedForPrint=[];
    window.addEventListener('beforeprint',()=>{collapsedForPrint=[...document.querySelectorAll('#results details:not([open])')];collapsedForPrint.forEach(d=>d.open=true);});
    window.addEventListener('afterprint',()=>{collapsedForPrint.forEach(d=>d.open=false);collapsedForPrint=[];});
    $('help-button').addEventListener('click',()=>$('help-dialog').showModal());
    $('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog')){const box=$('help-dialog').getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)$('help-dialog').close();}});
    window.addEventListener('gw-settings-changed',()=>{
      currentSettings=window.GWSettings.get();TARGETS=currentSettings.targets;
      refreshSettingsLabels();invalidate();
      $('empty-state').textContent='設定を変更しました。「両替プランを作成」で計算し直してください。';
    });
    refreshSettingsLabels();updateTotals();$('startup-warning').hidden=true;
  }
  try{init();}catch(error){const warning=$('startup-warning');if(warning){warning.hidden=false;warning.textContent='起動できませんでした。'+error.message;}}
})();
