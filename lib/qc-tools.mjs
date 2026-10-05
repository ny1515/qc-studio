const randomUUID = () => globalThis.crypto.randomUUID();

const col = (key,label,type='text',extra={}) => ({key,label,type,...extra});
const setting = (key,label,type,def,options) => ({key,label,type,default:def,...(options?{options:options.map(([value,label])=>({value,label}))}:{})});
const unit = () => setting('unit','単位','text','');
const entry = (kind,name,family,description,steps,columns,settings=[],maxRows=120,matrix=false) => ({kind,name,family,description,steps,columns,settings,maxRows,matrix});
export const TOOL_CATALOG = [
 entry('pareto','パレート図','qc','項目別の件数・量を大きい順に並べ、累積比率から重点を探します。',['theme','current','effect'],[col('label','項目'),col('value','件数・量','number',{min:0})],[setting('unit','単位','text','件')]),
 entry('fishbone','特性要因図','qc','結果に対する要因の仮説を分類し、魚の骨の形で整理します。',['causes'],[col('group','大骨の分類'),col('label','要因'),col('detail','要因の詳細')],[setting('effect','特性（結果・問題）','text','')],24),
 entry('checksheet','チェックシート','qc','項目と条件ごとに観察回数・発生件数を記録します。',['current','effect','standards'],[col('label','確認項目'),col('group','日付・場所などの条件'),col('value','記録件数','number',{min:0,integer:true})],[setting('unit','単位','text','件')]),
 entry('histogram','ヒストグラム','qc','測定値を等間隔の階級にまとめ、分布の形を確認します。',['current','effect'],[col('label','測定名（任意）'),col('value','測定値','number')],[setting('bins','階級数（1～20）','number',8),unit()]),
 entry('scatter','散布図','qc','同じ対象から得たXとYの組を描き、直線的な関連を調べます。',['causes','effect'],[col('label','対象名（任意）'),col('x','X値','number'),col('y','Y値','number')],[setting('xLabel','X軸の名称・単位','text','X'),setting('yLabel','Y軸の名称・単位','text','Y')]),
 entry('control','管理図','qc','時間順の測定から暫定の管理限界を計算します。規格限界とは異なります。',['current','effect','standards'],[col('label','時点・順序'),col('value','測定値／不良品数','number'),col('denominator','検査数（p管理図のみ）','number')],[setting('mode','管理図の種類','select','imr',[['imr','I-MR（個々の測定値）'],['p','p（不良品率）']]),unit()]),
 entry('graph','グラフ','qc','時系列の変化や項目間の量を折れ線・棒で比較します。',['current','effect'],[col('label','時点・項目'),col('value','値','number')],[setting('mode','グラフの種類','select','line',[['line','折れ線'],['bar','棒']]),unit()]),
 entry('affinity','親和図法','newqc','意見や事実を意味の近いグループにまとめます。分類は利用者が決めます。',['theme','current','causes'],[col('group','グループ'),col('label','意見・事実')],[],24),
 entry('relations','連関図法','newqc','原因から結果へ矢印を引き、要因のつながりを整理します。',['causes'],[col('key','要因ID'),col('label','要因'),col('to','影響先ID（カンマ区切り）')],[],24),
 entry('tree','系統図法','newqc','一つの目的から手段へ、親子関係で展開します。',['actions','standards'],[col('key','項目ID'),col('parent','親ID（根だけ空欄）'),col('label','目的・手段')],[],24),
 entry('matrix','マトリックス図法','newqc','行と列の関連を0・1・3・9で整理します。空欄は未評価です。',['causes','actions'],[],[setting('rowAxis','行側の名称','text','要因'),setting('columnAxis','列側の名称','text','対策')],12,true),
 entry('pca','マトリックス・データ解析法','newqc','標準化した数値行列を主成分分析し、対象の特徴をPC1・PC2で可視化します。',['current','causes'],[],[],60,true),
 entry('arrow','アロー・ダイヤグラム法','newqc','作業を矢印で表し、先行関係・所要時間・クリティカルパスを計算します。',['actions'],[col('key','作業ID'),col('label','作業'),col('from','開始結合点ID'),col('to','終了結合点ID'),col('value','所要時間','number',{min:0})],[setting('unit','時間の単位','text','日')],24),
 entry('pdpc','PDPC法','newqc','計画の各段階で問題を予測し、あらかじめ対応策を整理します。',['actions','standards'],[col('group','計画の段階'),col('label','実施内容'),col('risk','予想される問題'),col('response','対応策')],[],24),
 entry('stratification','層別','extra','設備・担当・時間帯などに分け、同じ指標の平均または合計を比較します。',['current','causes','effect'],[col('label','測定名（任意）'),col('group','層（分類）'),col('value','測定値','number')],[setting('aggregation','集計方法','select','mean',[['mean','単純平均'],['sum','合計']]),unit()]),
];
const def = kind => TOOL_CATALOG.find(d=>d.kind===kind);
const finite = n => typeof n==='number' && Number.isFinite(n);
const has = v => typeof v==='string' && v.trim().length>0;
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const sum = xs => xs.reduce((a,b)=>a+b,0);
const cleanText = (v,label,max=80) => {
 if(v===undefined||v===null)return '';
 if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v))throw new Error(`${label}は${max}文字以内の文字列で入力してください。`);
 return v;
};
function cleanNumber(v,label){
 if(v===undefined||v===null||v==='')return null;
 if(typeof v==='string') { if(!v.trim())return null; if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))throw new Error(`${label}は数値で入力してください。`); v=Number(v); }
 if(!finite(v)||Math.abs(v)>1e12)throw new Error(`${label}は絶対値1兆以下の有限な数値で入力してください。`);
 return v;
}
function cleanId(v){ if(!v)return randomUUID(); if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v))throw new Error('道具のIDが不正です。');return v; }
function obj(v,label){if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`${label}の形式が不正です。`);return v;}
const STEP_IDS=['theme','current','causes','actions','effect','standards','reflection'];
export function createTool(kind,{sample=false}={}){
 const d=def(kind);if(!d)throw new Error('未対応のQC道具です。');
 const t={id:randomUUID(),kind,title:d.name,step:d.steps[0],included:true,isSample:sample,notes:'',settings:Object.fromEntries(d.settings.map(s=>[s.key,s.default])),rows:[],matrix:{columns:[],rows:[]}};
 if(!sample)return t;
 t.title=`サンプル：${d.name}`; t.notes='サンプル（架空データ）。実際の記録へ置き換えてください。';
 const samples={
  pareto:[['ラベル違い',24],['貼付位置',12],['汚れ',6],['その他',3]],
  fishbone:[['方法','切り替え確認不足','旧ラベルの回収手順が曖昧'],['材料','類似ラベルの混在','品番別の区画がない'],['人','確認方法の差','教育内容を検証する'],['設備','表示の見にくさ','照明条件を確認する']],
  checksheet:[['ラベル違い','午前',4],['汚れ','午前',2],['ラベル違い','午後',6],['汚れ','午後',1]],
  histogram:[['1',9.8],['2',10.1],['3',10.0],['4',9.9],['5',10.2],['6',10.1],['7',10.3],['8',9.7]],
  scatter:[['A',1,2.1],['B',2,3.7],['C',3,6.2],['D',4,7.8],['E',5,9.6]],
  control:Array.from({length:25},(_,i)=>[String(i+1),[10,10.2,9.9,10.1,9.8][i%5],null]),
  graph:[['月',12],['火',10],['水',8],['木',7],['金',5]],
  affinity:[['切り替え','旧ラベルが残る'],['切り替え','確認方法が人で違う'],['保管','似たラベルが隣接'],['保管','区画表示が見にくい']],
  relations:[['A','確認手順が不明確','B,C'],['B','旧ラベルが残る','D'],['C','確認のばらつき','D'],['D','ラベルの貼り間違い','']],
  tree:[['A','','貼り間違いを減らす'],['B','A','切り替え手順を整える'],['C','A','保管場所を整える'],['D','B','回収確認を標準化'],['E','C','品番別の区画を設ける']],
  arrow:[['A','現場調査','1','2',2],['B','手順案の作成','2','3',3],['C','棚の配置変更','2','4',2],['D','教育','3','4',1],['E','試行・確認','4','5',2]],
  pdpc:[['手順変更','新しい確認表を配布','旧様式が残る','旧様式を回収して版を表示'],['試行','切り替え時に使用','確認時間が長くなる','作業を観察し重複項目を整理']],
  stratification:[['1','ラインA',10],['2','ラインA',12],['3','ラインB',6],['4','ラインB',8]],
 };
 if(samples[kind])t.rows=samples[kind].map(cells=>Object.assign({id:randomUUID()},Object.fromEntries(d.columns.map((c,i)=>[c.key,cells[i]??(c.type==='number'?null:'')]))));
 if(kind==='fishbone')t.settings.effect='ラベル貼り間違い';
 if(kind==='histogram')t.settings.bins=5;
 if(kind==='matrix')t.matrix={columns:['回収確認','区画分離','教育'],rows:[{id:randomUUID(),label:'ラベル残留',values:[9,1,3]},{id:randomUUID(),label:'ラベル混在',values:[1,9,3]}]};
 if(kind==='pca')t.matrix={columns:['作業時間','手直し件数','確認時間'],rows:[[12,5,2],[10,3,3],[8,2,4],[7,1,5],[11,4,2.5]].map((values,i)=>({id:randomUUID(),label:`班${i+1}`,values}))};
 return t;
}
export function normalizeTools(input){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>20)throw new Error('QC道具は20件以内の配列で指定してください。');
 const ids=new Set();
 return input.map(raw=>{
  obj(raw,'QC道具');const d=def(raw.kind);if(!d)throw new Error('未対応のQC道具です。');
  const t=createTool(raw.kind);t.id=cleanId(raw.id);if(ids.has(t.id))throw new Error('QC道具のIDが重複しています。');ids.add(t.id);
  t.title=cleanText(raw.title??d.name,'道具名',120);t.notes=cleanText(raw.notes,'道具のメモ',2000);
  t.step=raw.step??d.steps[0];if(!STEP_IDS.includes(t.step))throw new Error('関連工程が不正です。');
  for(const key of ['included','isSample']){if(raw[key]!==undefined&&typeof raw[key]!=='boolean')throw new Error('道具の選択状態が不正です。');t[key]=raw[key]??(key==='included');}
  const s=raw.settings===undefined?{}:obj(raw.settings,'道具の設定');
  for(const f of d.settings){const v=s[f.key]===undefined?f.default:s[f.key];t.settings[f.key]=f.type==='number'?cleanNumber(v,f.label):cleanText(v,f.label);if(f.type==='select'&&!f.options.some(o=>o.value===t.settings[f.key]))throw new Error(`${f.label}が不正です。`);}
  const rows=raw.rows??[];if(!Array.isArray(rows)||rows.length>d.maxRows)throw new Error(`${d.name}は${d.maxRows}行までです。`);
  const rids=new Set();t.rows=rows.map((row,i)=>{obj(row,'道具の行');const r={id:cleanId(row.id)};if(rids.has(r.id))throw new Error('道具の行IDが重複しています。');rids.add(r.id);for(const f of d.columns)r[f.key]=f.type==='number'?cleanNumber(row[f.key],`${i+1}行目の${f.label}`):cleanText(row[f.key],f.label);return r;});
  const m=raw.matrix===undefined?{columns:[],rows:[]}:obj(raw.matrix,'行列');
  if(!Array.isArray(m.columns)||!Array.isArray(m.rows))throw new Error('行列の形式が不正です。');
  if(m.columns.length>(d.kind==='pca'?8:12)||m.rows.length>(d.kind==='pca'?60:12))throw new Error('行列の行数または列数が上限を超えています。');
  t.matrix.columns=m.columns.map(x=>cleanText(x,'列名'));
  const mids=new Set();t.matrix.rows=m.rows.map(row=>{obj(row,'行列の行');if(!Array.isArray(row.values)||row.values.length!==m.columns.length)throw new Error('行列の列数が一致しません。');const id=cleanId(row.id);if(mids.has(id))throw new Error('行列の行IDが重複しています。');mids.add(id);return {id,label:cleanText(row.label,'行名'),values:row.values.map(v=>cleanNumber(v,'行列の値'))};});
  return t;
 });
}

const unique = a => [...new Set(a)];
const byGroup = (rows,key) => {const m=new Map();for(const r of rows){const k=r[key];if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const refs = s => unique(String(s??'').split(/[,、，\n]/).map(v=>v.trim()).filter(Boolean));
function pearson(xs,ys){const mx=mean(xs),my=mean(ys),dx=xs.map(v=>v-mx),dy=ys.map(v=>v-my),sx=sum(dx.map(v=>v*v)),sy=sum(dy.map(v=>v*v));if(sx===0||sy===0)return null;return Math.max(-1,Math.min(1,sum(dx.map((v,i)=>v*dy[i]))/Math.sqrt(sx*sy)));}
function topo(keys,edges){const incoming=new Map(keys.map(k=>[k,0])),out=new Map(keys.map(k=>[k,[]]));for(const [u,v] of edges){if(!out.has(u)||!incoming.has(v))return null;out.get(u).push(v);incoming.set(v,incoming.get(v)+1);}const q=keys.filter(k=>incoming.get(k)===0),order=[];for(let i=0;i<q.length;i++){const u=q[i];order.push(u);for(const v of out.get(u)){incoming.set(v,incoming.get(v)-1);if(incoming.get(v)===0)q.push(v);}}return order.length===keys.length?order:null;}
// Count with exact decimal ratios, so 0.3/0.1 does not fall into the lower bin.
// Each Number's canonical decimal is used; genuine values below a boundary stay below.
function histogramCounts(values,k){
 const parts=values.map(v=>{const [mantissa,exponent='0']=String(v).toLowerCase().split('e');return {n:BigInt(mantissa.replace('.','')),scale:(mantissa.split('.')[1]?.length??0)-Number(exponent)};});
 const scale=Math.max(0,...parts.map(p=>p.scale)),ints=parts.map(p=>p.n*10n**BigInt(scale-p.scale));
 const lo=ints.reduce((a,b)=>a<b?a:b),hi=ints.reduce((a,b)=>a>b?a:b),counts=Array(k).fill(0);
 for(const value of ints){const index=hi===lo?0:Number((value-lo)*BigInt(k)/(hi-lo));counts[Math.min(k-1,index)]++;}
 return counts;
}
// Jacobi rotation for the small real-symmetric correlation matrices (<=8x8).
export function symmetricEigen(matrix){
 const n=matrix.length,a=matrix.map(r=>r.slice()),v=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)));
 let converged=false;
 for(let iter=0;iter<100*n*n;iter++){
  let p=0,q=1,max=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(a[i][j])>max){max=Math.abs(a[i][j]);p=i;q=j;}
  if(max<1e-12){converged=true;break;}
  const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle),pp=a[p][p],qq=a[q][q],pq=a[p][q];
  for(let k=0;k<n;k++)if(k!==p&&k!==q){const kp=a[k][p],kq=a[k][q];a[k][p]=a[p][k]=c*kp-s*kq;a[k][q]=a[q][k]=s*kp+c*kq;}
  a[p][p]=c*c*pp-2*s*c*pq+s*s*qq;a[q][q]=s*s*pp+2*s*c*pq+c*c*qq;a[p][q]=a[q][p]=0;
  for(let k=0;k<n;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-s*kq;v[k][q]=s*kp+c*kq;}
 }
 if(!converged)throw new Error('主成分の計算が収束しませんでした。');
 return Array.from({length:n},(_,i)=>{const vector=v.map(r=>r[i]);const anchor=vector.reduce((j,x,k)=>Math.abs(x)>Math.abs(vector[j])?k:j,0);return {value:Math.max(0,a[i][i]),vector:vector.map(x=>vector[anchor]<0?-x:x)};}).sort((a,b)=>b.value-a.value);
}

export function analyzeTool(t){
 const d=def(t.kind),a={id:t.id,kind:t.kind,title:t.title,valid:false,errors:[],warnings:[],metrics:[],tables:[],charts:[],details:{}};
 if(!d){a.errors.push('未対応のQC道具です。');return a;}
 const fail=s=>a.errors.push(s),metric=(label,value,unit='')=>a.metrics.push({label,value,unit});
 const table=(name,columns,rows)=>a.tables.push({name,columns,rows});
 const chart=(type,title,categories,series,extra={})=>a.charts.push({type,title,categories,series,xLabel:'',yLabel:t.settings.unit??'',points:[],...extra});
 const rows=t.rows??[],s=t.settings??{};
 if(t.isSample)a.warnings.push('サンプル（架空データ）です。実際の記録ではありません。');
 const needText=(key,label)=>rows.forEach((r,i)=>{if(!has(r[key]))fail(`${i+1}行目：${label}を入力してください。`);});
 const needNum=(key,label,{min=-Infinity,integer=false}={})=>rows.forEach((r,i)=>{if(!finite(r[key]))fail(`${i+1}行目：${label}を入力してください。`);else if(r[key]<min||integer&&!Number.isInteger(r[key]))fail(`${i+1}行目：${label}の範囲または整数条件を確認してください。`);});
 if(d.matrix){
  const m=t.matrix??{columns:[],rows:[]};
  if(!m.columns.length||!m.rows.length)fail('行名・列名と数値を入力してください。');
  if(m.columns.some(v=>!has(v))||m.rows.some(r=>!has(r.label)))fail('行名・列名をすべて入力してください。');
  if(unique(m.columns).length!==m.columns.length||unique(m.rows.map(r=>r.label)).length!==m.rows.length)fail('行名・列名の重複を解消してください。');
  if(m.rows.some(r=>r.values.length!==m.columns.length))fail('行列の列数をそろえてください。');
  if(m.rows.some(r=>r.values.some(v=>!finite(v))))fail('行列に未入力または不正な数値があります。空欄は0として扱いません。');
  table('入力行列',['対象',...m.columns],m.rows.map(r=>[r.label,...r.values]));
  if(t.kind==='matrix'){
   if(m.rows.some(r=>r.values.some(v=>finite(v)&&![0,1,3,9].includes(v))))fail('関連度は0（なし）・1（弱）・3（中）・9（強）で入力してください。');
   a.warnings.push('関連度の設定は利用者の判断です。数値の大小だけで因果関係は確定しません。');
   if(!a.errors.length){table('関連度の集計',['行項目','合計'],m.rows.map(r=>[r.label,sum(r.values)]));a.details.matrix=m;}
  }else if(t.kind==='pca'){
   if(m.rows.length<3||m.columns.length<2)fail('主成分分析には3対象以上・2変数以上が必要です。');
   if(!a.errors.length){
    const n=m.rows.length,k=m.columns.length,means=m.columns.map((_,j)=>mean(m.rows.map(r=>r.values[j]))),sd=m.columns.map((_,j)=>Math.sqrt(sum(m.rows.map(r=>(r.values[j]-means[j])**2))/(n-1)));
    if(sd.some(v=>v===0))fail('値がすべて同じ変数があります。その列を除くか測定値を確認してください。');
    else{
     const z=m.rows.map(r=>r.values.map((v,j)=>(v-means[j])/sd[j])),correlation=Array.from({length:k},(_,i)=>Array.from({length:k},(_,j)=>sum(z.map(r=>r[i]*r[j]))/(n-1)));
     const eig=symmetricEigen(correlation),total=sum(eig.map(e=>e.value)),explained=eig.map(e=>e.value/total*100),scores=z.map(r=>eig.map(e=>sum(r.map((v,j)=>v*e.vector[j]))));
     a.details={means,sd,correlation,eigenvalues:eig.map(e=>e.value),coefficients:eig.map(e=>e.vector),explained,scores};
     metric('PC1寄与率',explained[0],'%');metric('PC2寄与率',explained[1],'%');metric('PC1＋PC2累積寄与率',explained[0]+explained[1],'%');
     table('主成分の寄与率',['主成分','固有値','寄与率（%）','累積寄与率（%）'],eig.map((e,i)=>[`PC${i+1}`,e.value,explained[i],sum(explained.slice(0,i+1))]));
     table('主成分係数（固有ベクトル）',['変数',...eig.map((_,i)=>`PC${i+1}`)],m.columns.map((label,j)=>[label,...eig.map(e=>e.vector[j])]));
     table('主成分得点',['対象',...eig.map((_,i)=>`PC${i+1}`)],m.rows.map((r,i)=>[r.label,...scores[i]]));
     table('標準化',['変数','平均','標本標準偏差'],m.columns.map((label,j)=>[label,means[j],sd[j]]));
     chart('scatter','主成分得点',[],[],{xLabel:`PC1（${explained[0].toFixed(1)}%）`,yLabel:`PC2（${explained[1].toFixed(1)}%）`,points:m.rows.map((r,i)=>({x:scores[i][0],y:scores[i][1],label:r.label}))});
    }
   }
   a.warnings.push('列ごとに標本標準偏差で標準化した相関行列の主成分分析です。寄与率と係数を合わせて解釈してください。');
   a.warnings.push('主成分の符号は反転しても同じ解です。固有値が等しい場合、軸の向きは一意に定まりません。');
  }
  a.valid=!a.errors.length;return a;
 }
 if(!rows.length){fail('データを1行以上入力してください。');return a;}
 table('入力データ',d.columns.map(c=>c.label),rows.map(r=>d.columns.map(c=>r[c.key]??null)));
 if(['pareto','checksheet','histogram','graph','stratification','control'].includes(t.kind))needNum('value','測定値・件数',{min:['pareto','checksheet'].includes(t.kind)?0:-Infinity,integer:t.kind==='checksheet'});
 if(['pareto','checksheet','graph','control'].includes(t.kind))needText('label','項目・時点');
 if(['checksheet','stratification','fishbone','affinity','pdpc'].includes(t.kind))needText('group','分類・段階');
 if(['fishbone','affinity','relations','tree','arrow','pdpc'].includes(t.kind))needText('label','内容');
 if(t.kind==='pdpc'){needText('risk','予想される問題');needText('response','対応策');}
 if(t.kind==='fishbone'&&!has(s.effect))fail('特性（結果・問題）を入力してください。');
 if(t.kind==='scatter'){needNum('x','X値');needNum('y','Y値');if(rows.length<2)fail('散布図には2組以上の測定値を入力してください。');}
 if(t.kind==='histogram'&&(!Number.isInteger(s.bins)||s.bins<1||s.bins>20))fail('階級数は1～20の整数で指定してください。');
 if(t.kind==='control'){
  if(rows.length<2)fail('管理図には時間順に2点以上のデータが必要です。');
  if(s.mode==='p'){needNum('value','不良品数',{min:0,integer:true});needNum('denominator','検査数',{min:1,integer:true});rows.forEach((r,i)=>{if(finite(r.value)&&finite(r.denominator)&&r.value>r.denominator)fail(`${i+1}行目：不良品数が検査数を超えています。`);});}
 }
 if(['relations','tree','arrow'].includes(t.kind)){
  needText('key','ID');if(unique(rows.map(r=>r.key)).length!==rows.length)fail('IDが重複しています。');
  if(rows.some(r=>/[,、，\n]/.test(r.key)))fail('IDにはカンマ・改行を使用できません。');
  if(t.kind==='arrow'){needText('from','開始結合点ID');needText('to','終了結合点ID');needNum('value','所要時間',{min:0});}
  else{
   const keys=rows.map(r=>r.key),edges=[];
   for(const r of rows){const dest=t.kind==='tree'?(has(r.parent)?[r.parent]:[]):refs(r.to);for(const k of dest){if(!keys.includes(k))fail(`${r.key}：参照先ID「${k}」がありません。`);if(k===r.key)fail(`${r.key}：自分自身への参照は指定できません。`);edges.push(t.kind==='tree'?[k,r.key]:[r.key,k]);}}
   a.details.edges=edges;
   if(t.kind==='tree'){if(rows.filter(r=>!has(r.parent)).length!==1)fail('系統図の根（親IDが空欄の行）は1つにしてください。');if(!a.errors.length&&!topo(keys,edges))fail('系統図に循環があります。親IDを確認してください。');}
  }
 }
 if(a.errors.length)return a;
 const values=rows.map(r=>r.value);
 switch(t.kind){
  case 'pareto': {
   const grouped=[...byGroup(rows,'label')].map(([label,rs])=>({label,value:sum(rs.map(r=>r.value))})).sort((a,b)=>b.value-a.value),total=sum(values);let running=0;
   const points=grouped.map(r=>({...r,cumulativePercent:total?((running+=r.value)/total*100):null}));
   metric('合計',total,s.unit);table('パレート集計',['項目','量','累積比率（%）'],points.map(r=>[r.label,r.value,r.cumulativePercent]));
   if(total===0)a.warnings.push('合計が0のため累積比率は定義できません。件数0として記録します。');
   chart('pareto','パレート図',points.map(r=>r.label),[{name:'量',values:points.map(r=>r.value)},{name:'累積比率（%）',values:points.map(r=>r.cumulativePercent),axis:'right'}]);a.details.pareto=points;break;
  }
  case 'checksheet': {
   const groups=unique(rows.map(r=>r.group)),labels=unique(rows.map(r=>r.label));const matrix=labels.map(label=>[label,...groups.map(group=>{const rs=rows.filter(r=>r.label===label&&r.group===group);return rs.length?sum(rs.map(r=>r.value)):null;})]);
   table('チェック集計',['確認項目',...groups],matrix);metric('記録件数',sum(values),s.unit);a.details.groups=groups;break;
  }
  case 'histogram': {
   const min=Math.min(...values),max=Math.max(...values),constant=min===max,k=constant?1:s.bins,width=constant?0:(max-min)/k,counts=histogramCounts(values,k);
   const bins=counts.map((count,i)=>({lower:min+i*width,upper:constant?max:min+(i+1)*width,count,upperInclusive:i===k-1}));
   const labels=bins.map(b=>constant?String(min):`${fmt(b.lower)}～${fmt(b.upper)}${b.upperInclusive?' 以下':' 未満'}`);
   table('度数分布',['下端（以上）','上端','上端を含む','度数'],bins.map(b=>[b.lower,b.upper,b.upperInclusive?'はい':'いいえ',b.count]));metric('測定数',values.length);metric('平均',mean(values),s.unit);
   chart('histogram','ヒストグラム',labels,[{name:'度数',values:counts}],{xLabel:s.unit,yLabel:'度数'});a.details.bins=bins;
   if(constant)a.warnings.push('すべて同じ値のため1階級で表示します。');break;
  }
  case 'scatter': {
   const r=pearson(rows.map(r=>r.x),rows.map(r=>r.y));metric('Pearson相関係数 r',r);if(r===null)a.warnings.push('XまたはYにばらつきがないため、相関係数は定義できません。');
   a.warnings.push('相関は因果関係を示しません。相関係数は直線的な関連の強さを表します。');
   chart('scatter','散布図',[],[],{xLabel:s.xLabel,yLabel:s.yLabel,points:rows.map((r,i)=>({x:r.x,y:r.y,label:r.label||String(i+1)}))});a.details.correlation=r;break;
  }
  case 'graph':chart(s.mode==='bar'?'bar':'line','グラフ',rows.map(r=>r.label),[{name:'値',values}]);break;
  case 'stratification':{
   const grouped=[...byGroup(rows,'group')].map(([group,rs])=>({group,count:rs.length,value:s.aggregation==='sum'?sum(rs.map(r=>r.value)):mean(rs.map(r=>r.value))}));
   table('層別集計',['層','測定数',s.aggregation==='sum'?'合計':'単純平均'],grouped.map(r=>[r.group,r.count,r.value]));chart('bar','層別比較',grouped.map(r=>r.group),[{name:s.aggregation==='sum'?'合計':'単純平均',values:grouped.map(r=>r.value)}]);a.details.groups=grouped;a.warnings.push('層ごとに測定条件や標本数を確認してください。平均は各行を同じ重みで計算します。');break;
  }
  case 'control':{
   const categories=rows.map(r=>r.label);let observed,cl,ucl,lcl;
   if(s.mode==='p'){
    const center=sum(values)/sum(rows.map(r=>r.denominator));observed=rows.map(r=>r.value/r.denominator*100);cl=rows.map(()=>center*100);ucl=rows.map(r=>Math.min(1,center+3*Math.sqrt(center*(1-center)/r.denominator))*100);lcl=rows.map(r=>Math.max(0,center-3*Math.sqrt(center*(1-center)/r.denominator))*100);
    metric('中心線',center*100,'%');a.warnings.push('p管理図は不良品の数を用います（1個を重複計数しない）。検査数ごとに3σ管理限界を計算します。');
   }else{
    const mr=values.slice(1).map((v,i)=>Math.abs(v-values[i])),mrMean=mean(mr),center=mean(values),distance=3*mrMean/1.128;
    observed=values;cl=rows.map(()=>center);ucl=rows.map(()=>center+distance);lcl=rows.map(()=>center-distance);
    metric('中心線',center,s.unit);metric('平均移動範囲',mrMean,s.unit);
    const mrUcl=3.267*mrMean;a.details.movingRange={values:[null,...mr],center:mrMean,ucl:mrUcl,lcl:0,outOfControl:mr.map((v,i)=>v>mrUcl?i+1:null).filter(v=>v!==null)};
    chart('line','MR管理図',categories,[{name:'移動範囲',values:[null,...mr]},{name:'CL',values:rows.map(()=>mrMean)},{name:'UCL',values:rows.map(()=>mrUcl)},{name:'LCL',values:rows.map(()=>0)}]);
    table('移動範囲',['時点','MR','CL','UCL','LCL'],rows.map((r,i)=>[r.label,i===0?null:mr[i-1],mrMean,mrUcl,0]));
    if(mrMean===0)a.warnings.push('移動範囲がすべて0のため管理限界の幅が0です。測定分解能や基準データを確認してください。');
   }
   const out=observed.map((v,i)=>v>ucl[i]||v<lcl[i]?i:null).filter(i=>i!==null);
   a.charts.unshift({type:'line',title:s.mode==='p'?'p管理図':'I管理図',categories,series:[{name:'測定値',values:observed},{name:'CL',values:cl},{name:'UCL',values:ucl},{name:'LCL',values:lcl}],xLabel:'入力順（時間順）',yLabel:s.mode==='p'?'%':s.unit,points:[]});
   table('管理限界',['時点','値','CL','UCL','LCL','限界超過'],rows.map((r,i)=>[r.label,observed[i],cl[i],ucl[i],lcl[i],out.includes(i)?'あり':'なし']));
   metric('管理限界を超えた点',out.length,'点');Object.assign(a.details,{observed,cl,ucl,lcl,outOfControl:out});
   a.warnings.push('入力順を時間順として、全入力データから暫定の管理限界を推定しています。工程変更の前後を混ぜず、基準期間を選んでください。');
   a.warnings.push('表示する異常判定は管理限界外の点だけです。連続点などの追加ルールや規格への適合は判定していません。');
   if(rows.length<20)a.warnings.push('基準データが20点未満です。少数データの暫定限界として扱ってください。');break;
  }
  case 'fishbone':case 'affinity':case 'pdpc':a.details.groups=[...byGroup(rows,'group')].map(([group,items])=>({group,items}));if(t.kind==='fishbone')a.warnings.push('特性要因図に記載する内容は要因の仮説です。現場で検証し、事実と区別してください。');break;
  case 'relations':{
   const edges=a.details.edges;table('矢印の集計',['ID','要因','出る矢印','入る矢印'],rows.map(r=>[r.key,r.label,edges.filter(e=>e[0]===r.key).length,edges.filter(e=>e[1]===r.key).length]));a.warnings.push('矢印は入力した関係の仮説です。矢印の本数だけで真因は確定しません。');break;
  }
  case 'tree':a.details.order=topo(rows.map(r=>r.key),a.details.edges);break;
  case 'arrow':{
   const keys=unique(rows.flatMap(r=>[r.from,r.to])),edges=rows.map(r=>[r.from,r.to]),order=topo(keys,edges);
   if(!order){fail('作業のつながりに循環があります。開始・終了結合点を確認してください。');break;}
   const starts=keys.filter(k=>!rows.some(r=>r.to===k)),ends=keys.filter(k=>!rows.some(r=>r.from===k));
   if(starts.length!==1||ends.length!==1){fail('開始結合点と終了結合点をそれぞれ1つにしてください。時間0のダミー作業で分岐・合流をつなげられます。');break;}
   const early=Object.fromEntries(keys.map(k=>[k,0]));for(const k of order)for(const r of rows.filter(r=>r.from===k))early[r.to]=Math.max(early[r.to],early[k]+r.value);
   const duration=early[ends[0]],late=Object.fromEntries(keys.map(k=>[k,duration]));for(const k of [...order].reverse())for(const r of rows.filter(r=>r.from===k))late[k]=Math.min(late[k],late[r.to]-r.value);
   const activities=rows.map(r=>{const slack=late[r.to]-early[r.from]-r.value;return {...r,earliestStart:early[r.from],earliestFinish:early[r.from]+r.value,latestStart:late[r.to]-r.value,latestFinish:late[r.to],totalFloat:Math.abs(slack)<1e-9?0:slack,critical:Math.abs(slack)<1e-9};});
   a.details={duration,order,nodes:keys.map(key=>({key,earliest:early[key],latest:late[key]})),activities,edges};metric('最短完了時間',duration,s.unit);metric('クリティカル作業数',activities.filter(r=>r.critical).length);
   table('日程計算',['ID','作業','開始点','終了点','所要時間','最早開始','最遅開始','余裕','クリティカル'],activities.map(r=>[r.key,r.label,r.from,r.to,r.value,r.earliestStart,r.latestStart,r.totalFloat,r.critical?'はい':'いいえ']));
   a.warnings.push('作業を矢印としたCPM計算です。資源制約・休日・同時作業の制限は考慮していません。');break;
  }
 }
 a.valid=!a.errors.length;return a;
}
function fmt(n){return n!==0&&Math.abs(n)<.001?n.toExponential(2):Number(n.toPrecision(5)).toString();}
export const analyzeTools = tools => (tools??[]).map(analyzeTool);
