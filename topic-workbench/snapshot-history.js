import {createSnapshotStore} from './snapshot-store.js';
import {storageKey} from './deployment-config.js';
import {snapshotCanvasModel, snapshotCardMarkup, snapshotFrameMarkup} from './snapshot-canvas.js';
import {renderSnapshotProjectDetails, renderSnapshotRecords} from './snapshot-preview.js';
import {renderCanvasItem} from './canvas-item-view.js';
import {referenceLinesMarkup} from './canvas-references.js';
import {mountDetailResize} from './detail-panel.js';

const $=id=>document.getElementById(id),viewport=$('historyViewport'),world=$('historyWorld');
const store=createSnapshotStore({key:storageKey('topic-workbench-snapshots-v1')});
let rows=[],snapshot=null,model=null,selectedId='',view={x:0,y:0,z:1},drag=null,activePid='',records=false,pendingDeleteId='';
const color=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#b8afa0';
const formatDate=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

function selectionControls(enabled){
  for(const id of ['showCanvas','showRecords','exportSnapshot','deleteSnapshot'])$(id).disabled=!enabled;
}
function emptySelection(title,text){
  snapshot=null;model=null;selectedId='';activePid='';records=false;drag=null;world.replaceChildren();$('historyRecords').replaceChildren();$('historyRecords').hidden=true;viewport.hidden=false;viewport.classList.remove('history-panning');$('historyDetail').hidden=true;
  $('snapshotTitle').textContent='历史快照';$('snapshotDate').textContent='';$('historyEmpty').hidden=false;$('historyEmptyTitle').textContent=title;$('historyEmptyText').textContent=text;$('historyZoom').hidden=true;selectionControls(false);
  $('showCanvas').setAttribute('aria-selected','true');$('showRecords').setAttribute('aria-selected','false');document.title='历史快照 · 基模-落地牵引项目管理';listSnapshots();
}
function showMissing(){emptySelection('这份快照不存在或已删除','请从左侧选择其他快照。');}
function showError(error){emptySelection('快照暂时无法读取',error.message||'请返回工作台查看存储状态。');}
function status(message){$('historyStatus').textContent=message;$('historyStatus').hidden=!message;}

function listSnapshots(){
  const q=$('snapshotSearch').value.trim().toLocaleLowerCase(),visible=rows.filter(r=>r.name.toLocaleLowerCase().includes(q)),nav=$('snapshotList');nav.replaceChildren();
  for(const row of visible){
    const button=document.createElement('button');button.type='button';button.className='history-snapshot'+(row.id===selectedId?' active':'');button.dataset.snapshotId=row.id;
    if(row.id===selectedId)button.setAttribute('aria-current','true');
    const title=document.createElement('strong'),time=document.createElement('time');title.textContent=row.name;time.textContent=formatDate(row.createdAt);time.dateTime=row.createdAt;button.append(title,time);nav.append(button);
  }
  $('snapshotListEmpty').hidden=visible.length>0;$('snapshotListEmpty').textContent=q?'没有匹配的快照':'暂无快照';
}
function applyView(){
  world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`;world.classList.toggle('overview',view.z<.55);$('historyZoomValue').textContent=Math.round(view.z*100)+'%';renderReferenceLines();
}
function renderReferenceLines(){
  world.querySelector('.canvas-reference-lines')?.remove();if(!model)return;const boxes=new Map();
  world.querySelectorAll('[data-instance]').forEach(el=>{const instance=model.instances.find(i=>i.id===el.dataset.instance);if(instance)boxes.set(instance.id,{x:instance.x,y:instance.y,w:el.offsetWidth,h:el.offsetHeight});});
  const markup=referenceLinesMarkup(model.instances,model.frames,boxes,{activePid});if(!markup)return;
  const template=document.createElement('template');template.innerHTML=markup;const svg=template.content.firstElementChild;world.insertBefore(svg,world.querySelector('[data-instance]')||world.querySelector('[data-canvas-item]'));
}
function zoom(factor,cx=viewport.clientWidth/2,cy=viewport.clientHeight/2){
  const z=Math.min(2,Math.max(.12,view.z*factor));view={x:cx-(cx-view.x)*z/view.z,y:cy-(cy-view.y)*z/view.z,z};applyView();
}
function fit(){
  if(!model?.bounds)return;const b=model.bounds,w=Math.max(1,b.right-b.left),h=Math.max(1,b.bottom-b.top),availableW=viewport.clientWidth,availableH=viewport.clientHeight;
  const z=Math.max(.12,Math.min(1.05,(availableW-80)/w,(availableH-100)/h));view={z,x:(availableW-w*z)/2-b.left*z,y:(availableH-h*z)/2-b.top*z};applyView();
}
function closeDetail(){activePid='';$('historyDetail').hidden=true;world.querySelectorAll('.is-active-project').forEach(el=>el.classList.remove('is-active-project'));renderReferenceLines();}
function openProject(pid){
  if(!snapshot||!model.byId.has(pid))return;activePid=pid;$('historyDetailBody').innerHTML=renderSnapshotProjectDetails(snapshot,pid);$('historyDetailBody').querySelector('details')?.setAttribute('open','');$('historyDetail').hidden=false;$('historyDetailBody').scrollTop=0;
  world.querySelectorAll('[data-pid]').forEach(el=>el.classList.toggle('is-active-project',el.dataset.pid===pid));renderReferenceLines();
}
function showTab(showRecords){
  records=showRecords;$('historyRecords').hidden=!records;viewport.hidden=records;$('historyZoom').hidden=records||!snapshot;
  $('historyEmpty').hidden=records||!!model?.bounds;
  $('showCanvas').setAttribute('aria-selected',String(!records));$('showRecords').setAttribute('aria-selected',String(records));closeDetail();
}
function renderCanvas(){
  world.replaceChildren();
  for(const frame of model.frames){
    const el=document.createElement('section');el.className='frame';el.dataset.frame=frame.id;el.dataset.tone=frame.tone||'sand';el.style.setProperty('--frame-color',color(frame.color));
    Object.assign(el.style,{left:frame.x+'px',top:frame.y+'px',width:frame.w+'px',height:frame.h+'px'});el.innerHTML=snapshotFrameMarkup(frame,model.data);world.append(el);
  }
  for(const instance of model.instances){
    const project=model.byId.get(instance.pid),el=document.createElement('article');el.className='project-card'+(project.kind==='direction'?' direction-card':'');el.dataset.instance=instance.id;el.dataset.pid=project.id;el.tabIndex=0;
    el.setAttribute('aria-label',project.name+'，查看快照详情');Object.assign(el.style,{left:instance.x+'px',top:instance.y+'px'});if(Number.isFinite(instance.w)&&instance.w>0)el.style.width=instance.w+'px';
    el.innerHTML=snapshotCardMarkup(project,instance,snapshot);world.append(el);
  }
  for(const item of model.items){const el=renderCanvasItem(item);el.querySelectorAll('.canvas-handle').forEach(h=>h.remove());el.removeAttribute('tabindex');el.removeAttribute('title');el.setAttribute('aria-label',item.type==='note'?'便签：'+(item.text||''):item.type==='text'?'文字：'+(item.text||''):item.type==='arrow'?'箭头':'线条');world.append(el);}
}
function selectSnapshot(id){
  try{
    const saved=store.read(id);if(!saved){rows=store.list();showMissing();return;}selectionControls(true);status('');selectedId=id;snapshot=saved;model=snapshotCanvasModel(saved);closeDetail();
    $('snapshotTitle').textContent=saved.name;$('snapshotDate').textContent=formatDate(saved.createdAt);$('historyEmpty').hidden=true;listSnapshots();renderCanvas();
    $('historyRecords').innerHTML=renderSnapshotRecords(saved);showTab(false);fit();
    const url=new URL(location.href);url.searchParams.set('snapshot',id);history.replaceState(null,'',url);document.title=saved.name+' · 历史快照';
    if(!model.bounds){$('historyEmpty').hidden=false;$('historyEmptyTitle').textContent='这份快照没有画板布局';$('historyEmptyText').textContent='可切换到「项目记录」查看保存的内容。';}
  }catch(error){showError(error);}
}
function load(){
  try{rows=store.list();listSnapshots();const requested=new URLSearchParams(location.search).get('snapshot');if(requested){if(rows.some(r=>r.id===requested))selectSnapshot(requested);else showMissing();}else if(rows.length)selectSnapshot(rows[0].id);else emptySelection('还没有保存的快照','在工作台点击「保存快照」，即可留存当时的画板。');}
  catch(error){showError(error);}
}
$('exportSnapshot').addEventListener('click',()=>{
  if(!snapshot)return;
  try{const content=store.export(selectedId),blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=('画板快照-'+snapshot.name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出快照');}
  catch(error){if(error.code==='SNAPSHOT_NOT_FOUND')showMissing();status('导出失败：'+error.message);}
});
$('deleteSnapshot').addEventListener('click',()=>{if(!snapshot)return;pendingDeleteId=selectedId;$('deleteSnapshotTitle').textContent='删除“'+snapshot.name+'”？';$('deleteSnapshotError').hidden=true;$('deleteSnapshotDialog').showModal();});
$('cancelDeleteSnapshot').addEventListener('click',()=>$('deleteSnapshotDialog').close());
$('deleteSnapshotForm').addEventListener('submit',e=>{
  e.preventDefault();if(!pendingDeleteId)return;
  try{const index=rows.findIndex(r=>r.id===pendingDeleteId),removed=store.remove(pendingDeleteId);pendingDeleteId='';rows=store.list();$('deleteSnapshotDialog').close();
    if(!removed){showMissing();return;}
    if(rows.length)selectSnapshot(rows[Math.min(Math.max(0,index),rows.length-1)].id);else{const url=new URL(location.href);url.searchParams.delete('snapshot');history.replaceState(null,'',url);emptySelection('还没有保存的快照','在工作台点击「保存快照」，即可留存当时的画板。');}status('快照已删除');
  }catch(error){$('deleteSnapshotError').textContent=error.message;$('deleteSnapshotError').hidden=false;}
});
$('deleteSnapshotDialog').addEventListener('close',()=>{pendingDeleteId='';});
$('snapshotList').addEventListener('click',e=>{const b=e.target.closest('[data-snapshot-id]');if(b)selectSnapshot(b.dataset.snapshotId);});
$('snapshotSearch').addEventListener('input',listSnapshots);$('historyCloseDetail').addEventListener('click',closeDetail);
$('showCanvas').addEventListener('click',()=>showTab(false));$('showRecords').addEventListener('click',()=>{showTab(true);$('historyEmpty').hidden=true;});
$('historyZoomIn').addEventListener('click',()=>zoom(1.15));$('historyZoomOut').addEventListener('click',()=>zoom(1/1.15));$('historyFit').addEventListener('click',fit);
$('historySavedView').addEventListener('click',()=>{const saved=snapshot?.data.view;if(saved&&[saved.x,saved.y,saved.z].every(Number.isFinite)&&saved.z>0){view={...saved};applyView();}});
viewport.addEventListener('pointerdown',e=>{if(drag||e.button!==0&&e.button!==1)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...view},pid:e.target.closest('[data-pid]')?.dataset.pid,moved:false};viewport.setPointerCapture(e.pointerId);viewport.classList.add('history-panning');e.preventDefault();});
viewport.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved||=Math.abs(dx)+Math.abs(dy)>4;if(drag.moved){view={...drag.view,x:drag.view.x+dx,y:drag.view.y+dy};applyView();}});
function endPan(e,cancel=false){if(!drag||drag.id!==e.pointerId)return;const g=drag;drag=null;viewport.classList.remove('history-panning');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);if(cancel){view=g.view;applyView();return;}if(!g.moved){if(g.pid)openProject(g.pid);else closeDetail();}}
viewport.addEventListener('pointerup',e=>endPan(e));viewport.addEventListener('pointercancel',e=>endPan(e,true));viewport.addEventListener('lostpointercapture',e=>endPan(e,true));
viewport.addEventListener('wheel',e=>{e.preventDefault();if(drag)return;if(e.ctrlKey||e.metaKey){const r=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.007),e.clientX-r.left,e.clientY-r.top);}else{view.x-=e.deltaX;view.y-=e.deltaY;applyView();}},{passive:false});
world.addEventListener('keydown',e=>{const card=e.target.closest('[data-pid]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openProject(card.dataset.pid);}});
document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select')||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){if(drag){const g=drag;endPan({pointerId:g.id},true);}closeDetail();}if(!records&&(e.key==='+'||e.key==='=')){e.preventDefault();zoom(1.15);}if(!records&&e.key==='-'){e.preventDefault();zoom(1/1.15);}});
window.addEventListener('blur',()=>{if(drag)endPan({pointerId:drag.id},true);});
window.addEventListener('storage',e=>{if(e.key===storageKey('topic-workbench-snapshots-v1')){try{rows=store.list();listSnapshots();if(selectedId&&!rows.some(row=>row.id===selectedId))showMissing();}catch(error){showError(error);}}});
mountDetailResize({panel:$('historyDetail'),handle:$('historyDetailResize'),container:$('historyWorkspace'),key:storageKey('topic-workbench-history-detail-width')});
load();
