/** Search user-visible content, never image payloads or internal bookkeeping. */
export function plainText(value) {
  return String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<\/?(?:p|div|li|br|blockquote|h[1-6]|tr|td|th)\b[^>]*>/gi,' ').replace(/<[^>]*>/g,'').replace(/data:[^\s]+/gi,' ')
    .replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';})
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g,(_,n)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[n]))
    .replace(/\s+/g,' ').trim();
}
export const normalize = value => plainText(value).normalize('NFKC').toLocaleLowerCase();
export const queryWords = query => [...new Set(normalize(query).split(/\s+/).filter(Boolean))];
export function matchesKeywords(text, query) {const words=queryWords(query),hay=normalize(text);return words.every(word=>hay.includes(word));}
const segment=(label,value,section='',weight=1)=>({label,text:plainText(value),section,weight});
const materials=rows=>(rows||[]).map(m=>segment('资料',[m.title,m.name,m.fileName,m.url].filter(Boolean).join(' '),'materials'));
function entry(type,id,title,meta,segments){const parts=segments.filter(s=>s.text);return {type,id,title:title||'未命名',meta,segments:parts,text:[title,...parts.map(s=>s.text)].join(' ')};}

export function buildSearchIndex(data, meetings=[]) {
  const tags=new Map((data.tagDefinitions||data.tags||[]).map(t=>[t.id,t.name]));
  const projects=new Map((data.projects||[]).map(p=>[p.id,p]));
  const frames=data.frames||[],boards=data.quickBoards||[],placements=data.instances||[];
  const result=[];
  for(const p of projects.values()){
    const copies=placements.filter(i=>i.pid===p.id),copyIds=new Set(copies.map(i=>i.id));
    const groups=frames.filter(f=>f.members?.some(id=>copyIds.has(id))).map(f=>f.name);
    const linkedBoards=boards.filter(b=>b.projectIds?.includes(p.id));
    const parents=(data.relations||[]).filter(r=>r.child===p.id).map(r=>projects.get(r.main)?.name).filter(Boolean);
    const parts=[segment('标题',p.name,'',8),segment('分类标签',(p.tagIds||[]).map(id=>tags.get(id)).filter(Boolean).join(' '),'',4),segment('分组',[...groups,...linkedBoards.map(b=>b.name)].join(' '),'',3),segment('主方向',parents.join(' '),'relations',3)];
    for(const [field,label,section] of [['description','问题陈述','description'],['result','结论','result'],['impact','影响','result'],['outcome','结果状态','result'],['freezeReason','冻结原因','disposition'],['terminationReason','终止原因','disposition'],['resumeCondition','恢复条件','disposition']])parts.push(segment(label,p.richText?.[field]||p[field],section));
    parts.push(segment('优先级',p.priority),segment('项目状态',({frozen:'Frozen 冻结',completed:'已完成 已结束',terminated:'已终止',active:'推进中'})[p.lifecycle]||p.status));
    for(const c of p.comments||[])parts.push(segment('评论',[c.author,c.richText?.body||c.body].filter(Boolean).join(' '),'comments',2));
    for(const s of p.customSections||[])parts.push(segment('栏目',[s.title,s.richText?.body||s.body].filter(Boolean).join(' '),'custom:'+s.id,2));
    for(const n of p.planNodes||[])parts.push(segment('计划节点',[n.title,n.owner,n.estimatedDate,n.targetDate,n.richText?.note||n.note].filter(Boolean).join(' '),'plans'));
    for(const r of (data.relations||[]).filter(r=>r.child===p.id||r.main===p.id))parts.push(segment('关联说明',r.note||r.context,'relations'));
    for(const i of copies)parts.push(segment('画板备注',i.context));
    for(const b of linkedBoards)parts.push(segment('看板备注',b.contexts?.[p.id]));
    parts.push(...materials(p.materials));
    result.push(entry('project',p.id,p.name,[p.kind==='direction'?'主方向':'',p.lifecycle==='frozen'?'Frozen':p.lifecycle==='terminated'?'已终止':p.closed?'已完成':'',...parents,...groups].filter(Boolean).join(' · '),parts));
  }
  for(const f of frames)result.push(entry('frame',f.id,f.name,'画板分组',[segment('分组',f.name,'',6),segment('说明',f.notes||f.description)]));
  for(const b of boards)result.push(entry('board',b.id,b.name,'行动看板',[segment('看板',b.name,'',6),segment('说明',b.notes),...Object.values(b.contexts||{}).map(c=>segment('备注',c))]));
  for(const i of data.canvasItems||[])if(['text','note'].includes(i.type))result.push(entry('annotation',i.id,plainText(i.text).slice(0,60)||'空白便签',i.type==='note'?'画板便签':'画板文字',[segment('内容',[i.text,i.html].filter(Boolean).join(' '))]));
  for(const m of meetings)result.push(entry('meeting',m.id,m.title,[m.category==='internal'?'落地内部':'基模-落地',m.date].filter(Boolean).join(' · '),[segment('会议',m.title,'',6),segment('日期',m.date),segment('会议记录',[m.richText?.notes||m.notes,m.conclusions].filter(Boolean).join(' ')),segment('后续跟进',m.richText?.followUp||m.followUp),...materials(m.materials)]));
  return result;
}

export function searchIndex(index,query) {
  const words=queryWords(query);if(!words.length)return [];
  return index.filter(row=>matchesKeywords(row.text,query)).map(row=>{
    const hit=row.segments.filter(s=>words.some(word=>normalize(s.text).includes(word))).sort((a,b)=>b.weight-a.weight)[0];
    const title=normalize(row.title),exact=title===normalize(query)?100:0;
    const score=exact+words.reduce((sum,word)=>sum+(title.startsWith(word)?20:title.includes(word)?10:0),0)+(hit?.weight||0);
    let excerpt=hit?.text||row.title,offset=words.map(w=>normalize(excerpt).indexOf(w)).filter(i=>i>=0).sort((a,b)=>a-b)[0]||0;
    const start=Math.max(0,offset-36);excerpt=(start?'…':'')+excerpt.slice(start,start+150)+(excerpt.length>start+150?'…':'');
    return {...row,score,excerpt,section:hit?.section||'',matchLabel:hit?.label||''};
  }).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'zh-CN'));
}
