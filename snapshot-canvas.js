import {isClosedProject} from './workbench-model.js';
import {displayPriority, displayDescription, visibleNodes} from './presentation.js';
import {deliveryCardMarkup} from './delivery-view.js';
import {canvasItemBounds} from './canvas-items.js';
import {childBadgeMarkup,childProjectRows,childTreeMarkup,parentCardMarkup} from './child-projects.js';

const list=value=>Array.isArray(value)?value:[];
const finite=Number.isFinite;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=(value,fallback='#b8afa0')=>/^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;
const pageIcon='<svg class="page-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2h7l4 4v12H5zM12 2v5h4M8 11h5M8 14h4"/></svg>';

/** A read-only geometry projection; coordinates and the saved document are never rewritten. */
export function snapshotCanvasModel(snapshot){
  const data=snapshot?.data||{},projects=list(data.projects),byId=new Map(projects.map(p=>[p.id,p]));
  const frames=list(data.frames).filter(f=>[f.x,f.y,f.w,f.h].every(finite)&&f.w>0&&f.h>0);
  const instances=list(data.instances).filter(i=>[i.x,i.y].every(finite)&&byId.has(i.pid)&&!isClosedProject(byId.get(i.pid)));
  const items=list(data.canvasItems).filter(i=>[i.x,i.y].every(finite)&&(['line','arrow'].includes(i.type)?[i.x2,i.y2].every(finite):['text','note'].includes(i.type)&&[i.w,i.h].every(finite)&&i.w>0&&i.h>0));
  const boxes=[...frames.map(f=>({x:f.x,y:f.y-48,w:f.w,h:f.h+48})),...instances.map(i=>({x:i.x,y:i.y,w:finite(i.w)&&i.w>0?i.w:282,h:finite(i.h)&&i.h>0?i.h:180})),...items.map(canvasItemBounds)];
  const bounds=boxes.length?{left:Math.min(...boxes.map(b=>b.x)),top:Math.min(...boxes.map(b=>b.y)),right:Math.max(...boxes.map(b=>b.x+b.w)),bottom:Math.max(...boxes.map(b=>b.y+b.h))}:null;
  return {data,projects,byId,frames,instances,items,bounds};
}

export function snapshotDay(createdAt){
  const date=new Date(createdAt);
  if(!Number.isFinite(date.getTime()))return '1970-01-01';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${values.year}-${values.month}-${values.day}`;
}

/** Match current card presentation, with dates evaluated at capture time, never today. */
export function snapshotCardMarkup(project,instance,snapshot){
  const data=snapshot.data,priority=displayPriority(project),tags=new Map(list(data.tags).map(t=>[t.id,t]));
  const nodes=visibleNodes({...project,planNodes:list(project.planNodes)}),node=nodes.find(n=>n.focus)||nodes.find(n=>n.owner||n.targetDate||n.estimatedDate);
  const children=childProjectRows(project.id,data),references=list(data.instances).filter(i=>i.pid===project.id).length;
  const expandable=project.kind==='direction',expanded=expandable&&instance.childrenExpanded===true;
  const eyebrow=[project.kind==='direction'?'方向':'',project.outcome].filter(Boolean).map(esc).join(' · ');
  const tagIds=list(project.tagIds),tagHTML=tagIds.slice(0,3).map(id=>tags.get(id)).filter(Boolean).map(t=>'<span class="card-tag" style="--tag-color:'+color(t.color)+'">'+esc(t.name)+'</span>').join('');
  return childBadgeMarkup(children.length,project.id,{readonly:true,expandable,expanded})+(eyebrow||instance.focus?'<div class="card-eyebrow">'+eyebrow+(instance.focus?'<span class="focus-mark">★ 本处重点</span>':'')+'</div>':'')+
    '<div class="card-heading">'+pageIcon+'<h3 class="card-title">'+esc(project.name)+'</h3><span class="detail-arrow" aria-hidden="true">↗</span></div>'+
    parentCardMarkup(project.id,data,{readonly:true})+'<div class="card-tags">'+(priority?'<span class="priority priority-editor" data-priority="'+esc(priority)+'">'+esc(priority)+'</span>':'')+tagHTML+(tagIds.length>3?'<span class="card-tag">+'+(tagIds.length-3)+'</span>':'')+'</div>'+
    (project.description?'<p class="card-note">'+esc(displayDescription(project.description))+'</p>':'')+
    deliveryCardMarkup({...project,planNodes:list(project.planNodes)},{today:snapshotDay(snapshot.createdAt)})+
    (node?.owner&&!node.targetDate&&!node.estimatedDate?'<div class="card-footer">'+esc(node.owner)+'</div>':'')+
    ((references>1||instance.context)?'<div class="card-reference">'+(references>1?'<span>'+references+' 处引用</span>':'')+(instance.context?'<span title="'+esc(instance.context)+'">有本处备注</span>':'')+'</div>':'')+(expanded?childTreeMarkup(children,{readonly:true}):'');
}

export function snapshotFrameMarkup(frame,data){
  const members=list(frame.members),instances=list(data.instances),count=new Set(members.map(id=>instances.find(i=>i.id===id)?.pid).filter(Boolean)).size;
  return '<div class="frame-head"><strong>'+esc(frame.name)+'</strong><span class="frame-count">'+count+'</span></div>';
}
