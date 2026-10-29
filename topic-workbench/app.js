import {createCanvasEditor} from './canvas-editor.js';
import {canvasItemBounds, translateCanvasItem} from './canvas-items.js';
import {enrichProjectContent} from './project-content.js';
import {DETAIL_SECTION_TITLES, detailLayout, detailSectionTitle, visibleDetailSections, moveDetailSection, setDetailSectionHidden, renameDetailSection, removeCustomSection, restoreCustomSection} from './project-detail-layout.js';
import {applyDomainTags} from './category-tags.js';
import {createSnapshotStore} from './snapshot-store.js';
import {findScheduleConflicts,findContentOverlaps} from './workbench-review.js';
import { enrichWorkbench, isClosedProject, sortProjectsByPriority, collectDirectionResults } from './workbench-model.js';
import { createWorkbenchViews, colorControl } from './workbench-views.js';
import { createPersistence } from './persistence.js';
import { detachSourceMetadata } from './source-detach.js';
import { displayPriority, visibleNodes, nodeStatus, displayDescription } from './presentation.js';
import {deployment, storageKey} from './deployment-config.js';
import {richEditorMarkup, mountRichEditors, readRichEditor, richHTML, flushRichEditors, destroyRichEditors} from './rich-text.js';
import {readProjectFlow, setCurrentFlowNode, setProjectClosed} from './project-flow.js';
import {flowMarkup, mountProjectFlow} from './project-flow-view.js';
import {reconcileDelivery, recordDeliveryLifecycle, deliveryCases, todayDate} from './delivery-model.js';
import {deliveryCardMarkup, deliveryPlanMarkup} from './delivery-view.js';
import {createDeliveryController} from './delivery-controller.js';
import {previewDeliveryUndo, applyDeliveryUndo} from './delivery-undo.js';
import {resizeFrameBounds, frameResizeEdges, frameEdgeNames} from './frame-resize.js';
import {mountDetailResize} from './detail-panel.js';
import {wheelDelta, enclosedFrameIds, moveSelection} from './canvas-gesture.js';
import {childBadgeMarkup, childSectionActionsMarkup, createChildProject} from './child-projects.js';
import {colorPickerMarkup, installColorPickers} from './color-presets.js';
import {moveFramesToEdge} from './frame-layers.js';
import {orderedTags,renameTag,moveTag,tagFilterMarkup,mountTagEditor} from './tag-editor.js';
import {referenceLinesMarkup, clonePlacement} from './canvas-references.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => prefix + '-' + crypto.randomUUID();
const mobile = () => matchMedia('(max-width:760px)').matches;
const safeURL = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const dateOnly = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0,10) : '';
const textValue = value => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const pageIcon = '<svg class="page-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2h7l4 4v12H5zM12 2v5h4M8 11h5M8 14h4"/></svg>';
let workbench = null, canvasEditor = null, flowEditor = null, deliveryController = null, tagEditor = null;
const inlineTimers = new Map();
let state, projects = [], byId = {}, tagById = {}, lastEditor, editorInstance, gesture = null, space = false, toastTimer, pendingFrame, clickSuppressed = false, lastFrameClick, dirty = false;
const viewport = $('viewport'), world = $('world');
$('saveStatus').title='修改保存在当前浏览器；数据与备份见设置';
const storage = createPersistence({key:storageKey('topic-workbench-v2'),onStatus: result => {
  if (result?.ok === false || result?.success === false) setSaveStatus(false);
}});
function documentData() { return {schemaVersion:2, workbenchVersion:state.workbenchVersion, domainTagVersion:state.domainTagVersion, projectContentVersion:state.projectContentVersion, quickBoards:state.quickBoards, deliveryEvents:state.deliveryEvents||[], sourceDetachedVersion:state.sourceDetachedVersion, projects:state.projects, tags:state.tagDefinitions, relations:state.relations, frames:state.frames, instances:state.instances, canvasItems:state.canvasItems||[], view:state.view}; }
function setSaveStatus(ok) { dirty = !ok; const saved='已本机保存';$('saveStatus').textContent = ok ? saved : '未保存 · 点击重试'; $('saveStatus').classList.toggle('unsaved',!ok);$('detailSaveStatus').textContent=ok?saved:'未保存 · 重试';$('detailSaveStatus').classList.toggle('unsaved',!ok); }
function save(history = true) { try { storage.commit(documentData(),{recordHistory:history||dirty}); setSaveStatus(true); $('undo').disabled = !storage.canUndo(); return true; } catch (e) {setSaveStatus(false); toast(e.name==='QuotaExceededError'?'浏览器存储空间不足，修改尚未保存。请先导出备份，再减少图片或清理旧快照后重试。':'保存失败：'+e.message+'。请重试或导出备份。'); return false;} }
function restoreData(data) {const {tags,...rest}=data;state = {...state,...rest,canvasItems:data.canvasItems||[],tagDefinitions:tags}; indexData();}
function indexData() {projects=state.projects; byId=Object.fromEntries(projects.map(p=>[p.id,p]));tagById=Object.fromEntries(state.tagDefinitions.map(t=>[t.id,t]));}
function mutate(fn, message='', options={}) {
  if(!flushRichEditors($('detailBody')))return false;
  if(canvasEditor?.flush()===false)return false;
  const before=clone(documentData());
  try {reconcileDelivery(state);fn();recordDeliveryLifecycle(state,before);reconcileDelivery(state);storage.validate(documentData());} catch(e) {restoreData(before);toast(e.message);return false;}
  indexData(); const saved=save();
  if(!saved&&options.rollbackOnSaveFailure){restoreData(before);renderAll({...options,keepDetail:true});return false;}
  renderAll(options);if(message&&saved)toast(message);return true;
}
function mutateFlow(pid,fn,message,options){
  // The flow editor guards its own flush while committing. Save the rest of the
  // detail before a stage change can rebuild it and discard pending field edits.
  if(!flushInline()||(dirty&&!save(false)))return false;
  return mutate(()=>{const wasClosed=isClosedProject(byId[pid]);fn();if(!wasClosed&&isClosedProject(byId[pid]))setDetailSectionHidden(byId[pid],'result',false);},message,{...options,rollbackOnSaveFailure:true});
}
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function mobileScope(){return state.frames.find(f=>f.id===state.scopeFrame)||null;}
function matches(p){const scope=mobileScope();if(scope&&state.display==='list'&&!scope.members.some(id=>state.instances.some(i=>i.id===id&&i.pid===p.id)))return false;if(state.display==='results'&&!isClosedProject(p))return false;if(['canvas','list','boards'].includes(state.display)&&isClosedProject(p))return false;const board=state.display==='boards'&&state.quickBoards.find(b=>b.id===state.activeBoard);if(board&&!board.projectIds.includes(p.id))return false;const q=state.query.trim().toLowerCase(),tags=[...state.tags];return (!q||(p.name+' '+p.id+' '+p.summary+' '+p.description+' '+(p.result||'')+' '+(p.impact||'')+' '+(p.comments||[]).map(c=>c.body).join(' ')+' '+(p.customSections||[]).map(s=>s.title+' '+s.body).join(' ')).toLowerCase().includes(q))&&(!tags.length||(state.logic==='union'?tags.some(t=>p.tagIds.includes(t)):tags.every(t=>p.tagIds.includes(t))));}
function matchesAnyFilter(){return state.tags.size>0||state.query.trim().length>0||(state.display==='list'&&!!mobileScope());}
function projectInstances(pid){return state.instances.filter(i=>i.pid===pid);}
function rankedTagIds(ids){return [...ids].sort((a,b)=>(tagById[a]?.rank??Infinity)-(tagById[b]?.rank??Infinity));}
function tagMarkup(id,removable=false){const t=tagById[id];if(!t)return '';return '<span class="card-tag" style="--tag-color:'+esc(t.color)+'">'+esc(t.name)+(removable?colorControl(t.color,'data-tag-color',id,'调整'+t.name+'颜色')+'<button data-detach-tag="'+esc(id)+'" aria-label="移除此项目的'+esc(t.name)+'标签">×</button>':'')+'</span>';}
function cardMarkup(p,{instance=null}={}){
  const nodes=visibleNodes(p),node=nodes.find(n=>n.focus)||nodes.find(n=>n.owner||n.targetDate||n.estimatedDate),childCount=state.relations.filter(r=>r.main===p.id).length;
  const priority=displayPriority(p),eyebrow=[p.kind==='direction'?'方向':'',p.outcome].filter(Boolean).map(esc).join(' · ');
  return childBadgeMarkup(childCount,p.id)+(eyebrow||instance?.focus?'<div class="card-eyebrow">'+eyebrow+(instance?.focus?'<span class="focus-mark">★ 本处重点</span>':'')+'</div>':'')+'<div class="card-heading">'+pageIcon+'<h3 class="card-title">'+esc(p.name)+'</h3>'+(instance?'<button class="card-copy" data-copy-instance="'+esc(instance.id)+'" title="复制到画板（⌘ / Ctrl + D）" aria-label="复制'+esc(p.name)+'到画板"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 5V3H3v10h2"/></svg></button>':'')+'<button class="detail-arrow" data-open="'+esc(p.id)+'" aria-label="查看'+esc(p.name)+'详情">↗</button></div>'+
  (true?'<div class="card-tags">'+priorityControl(p,true)+rankedTagIds(p.tagIds).slice(0,3).map(t=>tagMarkup(t)).join('')+(p.tagIds.length>3?'<span class="card-tag">+'+(p.tagIds.length-3)+'</span>':'')+'</div>':'')+
  (p.description?'<p class="card-note">'+esc(displayDescription(p.description))+'</p>':'')+
  deliveryCardMarkup(p)+(node?.owner&&!node.targetDate&&!node.estimatedDate?'<div class="card-footer">'+esc(node.owner)+'</div>':'')+
  ((projectInstances(p.id).length>1||instance?.context)?'<div class="card-reference">'+(projectInstances(p.id).length>1?'<span>'+projectInstances(p.id).length+' 处引用</span>':'')+(instance?.context?'<span title="'+esc(instance.context)+'">有本处备注</span>':'')+'</div>':'');
}
function cardElement(p,instance=null){const el=document.createElement('article');el.className='project-card'+(p.kind==='direction'?' direction-card':'');el.dataset.pid=p.id;el.tabIndex=0;el.setAttribute('aria-label',p.name+'，按回车查看详情');if(instance){el.dataset.instance=instance.id;el.style.left=instance.x+'px';el.style.top=instance.y+'px';}el.innerHTML=cardMarkup(p,{instance});el.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.target.closest('button,select,input,textarea,a,[contenteditable="true"]')){e.preventDefault();e.stopPropagation();openDetail(p.id,instance?.id);}});return el;}
let hoveredProject = null;
function renderReferenceLines(){
  if(!state)return;world.querySelector('.canvas-reference-lines')?.remove();
  const bounds=new Map(),dimmedPids=new Set();
  world.querySelectorAll('[data-instance]').forEach(el=>{if(!el.offsetWidth)return;bounds.set(el.dataset.instance,{x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:el.offsetWidth,h:el.offsetHeight});if(el.classList.contains('dimmed'))dimmedPids.add(el.dataset.pid);});
  const markup=referenceLinesMarkup(state.instances,state.frames,bounds,{activePid:state.detail||hoveredProject,dimmedPids});
  const firstCard=world.querySelector('[data-instance]');if(firstCard)firstCard.insertAdjacentHTML('beforebegin',markup);
}
function duplicateInstances(ids){
  if(!flushInline()||canvasEditor?.clear()===false)return;
  const originals=state.instances.filter(i=>ids.includes(i.id));if(!originals.length)return;
  const copies=[];
  if(mutate(()=>{for(const original of originals){const copy=clonePlacement(original,{id:uid('place'),placements:state.instances});state.instances.push(copy);copies.push(copy);for(const f of state.frames)if(f.members.includes(original.id))f.members.push(copy.id);}state.selectedFrames.clear();state.selected=new Set(copies.map(i=>i.id));},'已复制到画板，内容共用一份',{keepDetail:true}))world.querySelector('[data-instance="'+copies[0].id+'"]')?.focus({preventScroll:true});
}
function renderFrameNav(){ $('frameNav').innerHTML=state.frames.map(f=>'<button class="sidebar-item'+(state.scopeFrame===f.id?' current':'')+'" data-focus-frame="'+esc(f.id)+'"><span class="frame-nav-icon">▱</span><span>'+esc(f.name)+'</span><small>'+new Set(f.members.map(id=>state.instances.find(i=>i.id===id)?.pid).filter(Boolean)).size+'</small></button>').join('');}
function renderWorld(options={}){
  world.innerHTML='';
  const layer=document.createElement('div');layer.className='canvas-frame-layer';world.append(layer);
  for(const [index,f] of state.frames.entries()){
    const el=document.createElement('section');el.className='frame';el.dataset.frame=f.id;el.dataset.tone=f.tone||'sand';
    el.style.setProperty('--frame-color',f.color||'#b8afa0');if(f.backgroundColor)el.style.setProperty('--frame-background',f.backgroundColor);
    Object.assign(el.style,{left:f.x+'px',top:f.y+'px',width:f.w+'px',height:f.h+'px',zIndex:String(index+1)});
    el.innerHTML=frameResizeEdges.map(edge=>'<button type="button" class="frame-resize frame-resize-'+edge+'" data-resize-frame="'+esc(f.id)+'" data-resize-edge="'+edge+'" aria-label="调整'+esc(f.name)+frameEdgeNames[edge]+'" title="拖动'+frameEdgeNames[edge]+'调整大小；方向键微调，Shift 加快"></button>').join('')+
      '<div class="frame-head" data-frame-head="'+esc(f.id)+'" tabindex="0" aria-label="选择分组：'+esc(f.name)+'">'+colorControl(f.backgroundColor||f.color,'data-frame-color',f.id,'调整'+f.name+'背景')+'<strong>'+esc(f.name)+'</strong><span class="frame-count">'+new Set(f.members.map(id=>state.instances.find(i=>i.id===id)?.pid).filter(Boolean)).size+'</span><button data-add-frame="'+esc(f.id)+'" title="向分组引用项目">＋</button><button data-rename-frame="'+esc(f.id)+'">改名</button><button data-remove-frame="'+esc(f.id)+'" title="取消分组，保留项目">取消分组</button></div>';
    layer.append(el);
  }
  for(const i of state.instances)if(!isClosedProject(byId[i.pid]))world.append(cardElement(byId[i.pid],i));
  canvasEditor?.render();renderFrameNav();applyView();applyFilter(options);renderSelection();
}
function renderTags(){const draft=tagEditor?.capture();$('tags').innerHTML=tagFilterMarkup(state.tagDefinitions,state.tags,colorControl);tagEditor?.restore(draft);}
function applyFilter(options={}){const filtered=matchesAnyFilter();world.querySelectorAll('.project-card').forEach(el=>{const yes=matches(byId[el.dataset.pid]);el.classList.toggle('dimmed',filtered&&!yes);el.classList.toggle('match',filtered&&yes);});$('logic').hidden=state.tags.size<2;$('clear').hidden=!filtered&&state.mode!=='gather';const count=projects.filter(matches).length;$('canvasCount').textContent=projects.length+' 个项目 · '+state.frames.length+' 个分组'+(filtered?' · 匹配 '+count+' 项':'');$('searchEmpty').hidden=!filtered||count>0||state.mode==='gather';if(!options.keepMain){renderMobile();workbench?.render();}renderGather();syncActiveProject();for(const mode of ['highlight','gather']){$(mode).classList.toggle('active',state.mode===mode);$(mode).setAttribute('aria-pressed',String(state.mode===mode));}}
function renderMobile(){const el=$('mobileList');el.innerHTML='<div class="mobile-caption"><span>'+(mobileScope()?esc(mobileScope().name)+' · ':'全部项目 · ')+projects.filter(matches).length+' 项</span></div>';sortProjectsByPriority(projects.filter(matches)).forEach(p=>{const c=cardElement(p);c.addEventListener('click',e=>{if(!e.target.closest('select,input,button'))openDetail(p.id);});el.append(c);});}
function renderGather(){canvasEditor?.sync();const show=state.mode==='gather';$('gatherMask').hidden=!show;$('gatherPanel').hidden=!show;if(!show)return;const list=sortProjectsByPriority(projects.filter(matches));$('gatherTitle').textContent=state.tags.size?[...state.tags].map(id=>tagById[id]?.name).join(state.logic==='union'?' ∪ ':' ∩ '):state.query?'搜索结果':'全部项目';$('gatherSummary').textContent=list.length+' 个项目';const target=$('gatherCards');target.innerHTML='';list.forEach((p,n)=>{const el=cardElement(p);el.style.animationDelay=Math.min(n*25,150)+'ms';el.addEventListener('click',e=>{if(!e.target.closest('select,input,button'))openDetail(p.id);});target.append(el);});if(!list.length)target.innerHTML='<div class="gather-empty">没有满足此标签组合的项目</div>';}
function renderSelection(){
  state.selectedFrames=new Set([...state.selectedFrames].filter(id=>state.frames.some(f=>f.id===id)));
  const members=new Set(state.frames.filter(f=>state.selectedFrames.has(f.id)).flatMap(f=>f.members));
  world.querySelectorAll('[data-instance]').forEach(el=>el.classList.toggle('selected',state.selected.has(el.dataset.instance)));
  world.querySelectorAll('[data-frame]').forEach(el=>el.classList.toggle('selected',state.selectedFrames.has(el.dataset.frame)));
  const cardCount=[...state.selected].filter(id=>!members.has(id)).length,frameCount=state.selectedFrames.size;
  $('selectionActions').hidden=(!state.selected.size&&!frameCount)||state.mode==='gather';
  $('selectionCount').textContent=[frameCount?frameCount+' 个分组':'',cardCount?cardCount+' 张卡片':''].filter(Boolean).join(' · ');
  $('groupTool').disabled=$('groupSelection').disabled=!state.selected.size||frameCount>0;
  $('duplicateSelection').disabled=!state.selected.size||frameCount>0;$('referenceSelection').disabled=!state.selected.size;
  for(const id of ['groupSelection','duplicateSelection','referenceSelection'])$(id).hidden=frameCount>0;
  $('frameStyleControls').hidden=!frameCount;
  if(frameCount){
    const selected=state.frames.filter(f=>state.selectedFrames.has(f.id));
    $('selectedFrameColor').innerHTML=colorPickerMarkup(selected[0].backgroundColor||selected[0].color,'data-selected-frame-color','all','分组背景',{variant:'surface'});
    for(const [id,edge] of [['bringFrameFront','front'],['sendFrameBack','back']])$(id).disabled=moveFramesToEdge(state.frames,state.selectedFrames,edge).every((f,i)=>f===state.frames[i]);
  }

}

function renderAll(options={}){indexData();state.tags=new Set([...state.tags].filter(id=>tagById[id]));$('totalProjects').textContent=projects.length;$('loadCaption').textContent='';renderTags();renderWorld(options);workbench?.renderNav();if(!options.keepDetail&&state.detail&&byId[state.detail])openDetail(state.detail,state.detailInstance,false);syncActiveProject();}
function setTool(t){if(canvasEditor?.flush()===false)return;state.tool=t;if(['text','note','line','arrow'].includes(t)&&state.mode==='gather'){state.mode='highlight';applyFilter();}viewport.classList.toggle('annotating',['text','note','line','arrow'].includes(t));viewport.classList.toggle('panning',t==='pan');viewport.classList.toggle('framing',t==='frame');document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===t);b.setAttribute('aria-pressed',String(b.dataset.tool===t));});canvasEditor?.onToolChange();}
function applyView(){const v=state.view;if(viewport.scrollLeft||viewport.scrollTop){v.x-=viewport.scrollLeft;v.y-=viewport.scrollTop;viewport.scrollLeft=0;viewport.scrollTop=0;}world.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.z})`;world.style.setProperty('--frame-hit',12/v.z+'px');world.style.setProperty('--frame-grip',7/v.z+'px');world.style.setProperty('--frame-stroke',1/v.z+'px');world.style.setProperty('--canvas-copy-size',22/v.z+'px');world.style.setProperty('--canvas-copy-offset',2/v.z+'px');$('zoomValue').textContent=Math.round(v.z*100)+'%';renderReferenceLines();}
function zoom(delta,cx=viewport.clientWidth/2,cy=viewport.clientHeight/2,persist=true){const v=state.view,next=Math.max(.18,Math.min(1.8,v.z*delta));v.x=cx-(cx-v.x)*next/v.z;v.y=cy-(cy-v.y)*next/v.z;v.z=next;applyView();if(persist)save(false);}
function fit(){const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;const boxes=state.instances.map(boxFor).concat(state.frames.map(f=>({x:f.x,y:f.y-34,w:f.w,h:f.h+34}))).concat((state.canvasItems||[]).map(canvasItemBounds));if(!boxes.length)return;const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h)),z=Math.max(.18,Math.min(1.05,(w-72)/(maxX-minX),(h-100)/(maxY-minY)));state.view={z,x:(w-(maxX-minX)*z)/2-minX*z,y:30-minY*z};state.scopeFrame=null;renderFrameNav();applyView();save(false);}
function focusFrame(id){const f=state.frames.find(f=>f.id===id);if(!f)return;state.scopeFrame=f.id;if(mobile()||state.display==='list'){setDisplay('list');toggleSidebar(false);applyFilter();renderFrameNav();return;}const w=viewport.clientWidth,h=viewport.clientHeight,z=Math.max(.3,Math.min(1.1,(w-100)/f.w,(h-90)/(f.h+34)));state.view={z,x:(w-f.w*z)/2-f.x*z,y:(h-f.h*z)/2-f.y*z};renderFrameNav();applyView();save(false);}
function toWorld(x,y){const r=viewport.getBoundingClientRect();return{x:(x-r.left-state.view.x+viewport.scrollLeft)/state.view.z,y:(y-r.top-state.view.y+viewport.scrollTop)/state.view.z};}
function boxFor(i){const el=world.querySelector('[data-instance="'+i.id+'"]');return{x:i.x,y:i.y,w:282,h:el?.offsetHeight||166};}
function intersects(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function selectedBounds(){const boxes=state.instances.filter(i=>state.selected.has(i.id)).map(boxFor);if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x))-22,y=Math.min(...boxes.map(b=>b.y))-24;return{x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x+22,h:Math.max(...boxes.map(b=>b.y+b.h))-y+24};}
function requestFrame(bounds,ids,rename=null){pendingFrame={bounds,ids,rename};$('nameTitle').textContent=rename?'重命名讨论框':'命名讨论框';$('frameName').value=rename?state.frames.find(f=>f.id===rename).name:'';$('nameDialog').showModal();$('frameName').focus();}
function groupSelection(){if(state.selectedFrames.size)return;const b=selectedBounds();if(b)requestFrame(b,[...state.selected]);}
function section(title,body,action=''){return '<section class="detail-section"><h3><span>'+title+'</span>'+action+'</h3>'+body+'</section>';}
function actionButton(label,action,id=''){return '<button class="text-action" data-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';}
function relatedMarkup(pid){
  let html='';
  for(const [key,title,other] of [['main','关联小项目','child'],['child','所属主项目','main']]){
    const links=state.relations.filter(r=>r[key]===pid);if(!links.length&&key!=='main')continue;
    const rows=links.map(r=>{const p=byId[r[other]];return '<div class="relation-row"><button class="related-card" data-related="'+esc(p.id)+'"><strong>'+esc(p.name)+'<span>↗</span></strong>'+(p.outcome?'<small>'+esc(p.outcome)+'</small>':'')+((isClosedProject(p)?p.result:p.description)?'<small class="shared-result">'+esc(isClosedProject(p)?p.result:displayDescription(p.description))+'</small>':'')+'</button>'+(r.context?'<p class="relation-context">'+esc(r.context)+'</p>':'')+'<div class="row-actions">'+(r.draft?'<span class="draft-badge">待确认</span>':'')+actionButton('编辑关联','relation-edit',r.id)+'</div></div>';}).join('');
    html+=section(title+' · '+links.length,rows);
  }
  return html;
}
function nodeMarkup(n){const status=nodeStatus(n.status),showStatus=status&&status!==n.title&&!(['处理中','进行中'].includes(n.title)&&status==='进行中');return '<div class="node-row"><div class="node-heading"><strong>'+esc(n.title)+'</strong>'+actionButton('编辑','node-edit',n.id)+'</div>'+(n.owner?'<p>'+esc(n.owner)+'</p>':'')+((n.targetDate||n.estimatedDate)?'<div class="node-dates">'+(n.targetDate?'<span>目标 '+esc(n.targetDate)+'</span>':'')+(n.estimatedDate?'<span>预计 '+esc(n.estimatedDate)+'</span>':'')+'<span>'+(n.dateConfirmed?'已确认':'未确认')+'</span></div>':'')+(showStatus?'<small>'+esc(status)+'</small>':'')+(n.note?'<p class="preserve-text">'+esc(n.note)+'</p>':'')+'</div>';}
function readableText(value){
  const text=displayDescription(value),pattern=/https?:\/\/[^\s<>"'（）()，。；]+/g;let html='',offset=0;
  for(const match of text.matchAll(pattern)){
    html+=esc(text.slice(offset,match.index));const url=safeURL(match[0]);
    if(url){const host=new URL(url).hostname,label=host.replace(/^www\./,'');html+='<a class="inline-material-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" title="'+esc(url)+'">'+esc(label)+' ↗</a>';}else html+=esc(match[0]);
    offset=match.index+match[0].length;
  }
  return html+esc(text.slice(offset));
}
function detailMenu(label,body){return '<div class="detail-menu"><button type="button" class="menu-trigger" aria-expanded="false">'+label+'</button><div class="detail-menu-content">'+body+'</div></div>';}
function priorityControl(p,card=false){
  const value=displayPriority(p),values=['','P0','P1','P2','长期'];if(value&&!values.includes(value))values.push(value);
  return '<select class="priority priority-editor'+(card&&!displayPriority(p)?' unset-priority':'')+'" data-priority-editor="'+esc(p.id)+'" data-priority="'+esc(p.priority)+'" aria-label="'+esc(p.name)+'优先级">'+values.map(v=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(v||(card?'＋ 优先级':'未设置'))+'</option>').join('')+'</select>';
}
function resizeInlineFields(root=$('detailBody')){
  root.querySelectorAll('textarea[data-autogrow]').forEach(el=>{el.style.height='0px';el.style.height=Math.max(el.closest('.inline-title')?0:el.classList.contains('comment-draft')?56:72,el.scrollHeight+2)+'px';});
}
function syncActiveProject(){
  renderReferenceLines();
  document.body.classList.toggle('project-detail-open',!!state?.detail);
  document.querySelectorAll('.project-card,[data-project-highlight]').forEach(el=>{
    const active=!!state?.detail&&(el.dataset.pid||el.dataset.projectHighlight)===state.detail;
    el.classList.toggle('is-active-project',active);if(active)el.setAttribute('aria-current','true');else el.removeAttribute('aria-current');
  });
}
function revealActiveProject(){
  if(mobile())return;
  if(state.display==='canvas'){
    const cards=[...world.querySelectorAll('.project-card.is-active-project')],card=cards.find(el=>el.dataset.instance===state.detailInstance)||cards[0];if(!card)return;
    const rect=card.getBoundingClientRect(),bounds=viewport.getBoundingClientRect(),right=Math.min(bounds.right,$('detail').getBoundingClientRect().left);
    if(rect.left<bounds.left+20||rect.right>right-20||rect.top<bounds.top+20||rect.bottom>bounds.bottom-20){state.view.x+=(bounds.left+right)/2-(rect.left+rect.right)/2;state.view.y+=(bounds.top+bounds.bottom)/2-(rect.top+rect.bottom)/2;applyView();}
  }else{
    const root=state.display==='list'?$('mobileList'):$('workbenchView');root.querySelector('.is-active-project')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
}
function detailUndo(message,restore){
  if(dirty)return;toast(message);const button=document.createElement('button');button.type='button';button.className='toast-undo';button.textContent='撤销';button.addEventListener('click',restore,{once:true});$('toast').append(button);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,8000);
}
function focusDetailSection(key,title=false){
  const section=[...$('detailBody').querySelectorAll('[data-detail-section]')].find(el=>el.dataset.detailSection===key);if(!section)return;
  section.scrollIntoView({block:'nearest'});const control=section.querySelector(title?'.section-title-input':'[data-section-rename]');control?.focus({preventScroll:true});if(title)control?.select();
}
function projectSectionMarkup(p,block,keys){
  const index=keys.indexOf(block.key),custom=block.key.startsWith('custom:'),title=detailSectionTitle(p,block.key);
  const input=custom?'data-inline="title" data-section-id="'+esc(block.key.slice(7))+'"':'data-inline="layoutTitle" data-layout-key="'+esc(block.key)+'"';
  const remove=custom?'<button type="button" data-delete-section="'+esc(block.key.slice(7))+'" aria-label="删除栏目 '+esc(title)+'" title="删除栏目，可撤销">×</button>':block.key!=='description'?'<button type="button" data-hide-section="'+esc(block.key)+'" aria-label="隐藏栏目 '+esc(title)+'，保留内容" title="隐藏栏目，内容保留">×</button>':'';
  return '<section class="project-content-section '+(block.className||'')+'" data-detail-section="'+esc(block.key)+'"><header class="project-section-head"><input class="inline-input section-title-input" '+input+' aria-label="'+esc(title)+'栏目名称" placeholder="'+esc(custom?'栏目名称':DETAIL_SECTION_TITLES[block.key])+'" value="'+esc(custom?p.customSections.find(section=>'custom:'+section.id===block.key).title:title)+'"><div class="section-tools"><button type="button" data-section-rename="'+esc(block.key)+'" aria-label="重命名栏目 '+esc(title)+'" title="重命名">✎</button><button type="button" data-move-section="'+esc(block.key)+'" data-step="-1" aria-label="上移栏目 '+esc(title)+'" title="上移"'+(index===0?' disabled':'')+'>↑</button><button type="button" data-move-section="'+esc(block.key)+'" data-step="1" aria-label="下移栏目 '+esc(title)+'" title="下移"'+(index===keys.length-1?' disabled':'')+'>↓</button>'+remove+'</div>'+(block.action||'')+'</header>'+block.body+'</section>';
}
function projectDetailSections(p,nodes){
  const blocks=[{key:'description',className:'problem-statement',body:inlineText('description',detailSectionTitle(p,'description'),displayDescription(p.description),{rows:4,autogrow:true,placeholder:'描述需要解决的问题、场景与影响…'})}];
  if(isClosedProject(p))blocks.push({key:'result',className:'result-editor',body:inlineText('result','解决 / 牵引了什么问题',p.result,{rows:3,autogrow:true,placeholder:'项目结束后，记录解决的问题与最终结果'})+inlineText('impact','影响与证据说明',p.impact||'',{rows:2,autogrow:true,placeholder:'数据变化、落地影响、验证边界…'})+inlineText('closedAt','结束日期',p.closedAt||'',{type:'date'})});
  (p.customSections||[]).forEach(section=>blocks.push({key:'custom:'+section.id,className:'custom-section',body:inlineText('body','栏目内容',section.body,{section:section.id,rows:3,autogrow:true,placeholder:'记录这个栏目下的内容…'})}));
  blocks.push({key:'comments',className:'comment-pool',body:commentPoolMarkup(p)},...inlineRelations(p.id));const history=directionHistory(p);if(history)blocks.push(history);
  if(nodes.length)blocks.push({key:'plans',body:nodes.map(node=>inlinePlan(node,nodes.length)).join(''),action:actionButton('＋ 计划','inline-node-add')});
  blocks.push({key:'materials',body:p.materials.map(material=>'<div class="material-row"><button class="material-link" data-preview="'+esc(material.id)+'"><span>▧ '+esc(material.title||new URL(material.url).hostname)+'</span></button>'+actionButton('编辑','material-edit',material.id)+'</div>').join(''),action:actionButton('＋ 链接','material-add')});
  return blocks;
}
function detailRestoreMenu(p,available){
  const hidden=detailLayout(p).hidden.filter(key=>available.includes(key));
  return hidden.length?'<div class="hidden-section-menu"><span>已隐藏的栏目</span>'+hidden.map(key=>'<button type="button" class="text-action" data-restore-section="'+esc(key)+'">＋ '+esc(detailSectionTitle(p,key))+'</button>').join('')+'</div>':'';
}
function commentPoolMarkup(p){
  const rows=[...(p.comments||[])].reverse();
  const entries=rows.map(c=>{let time='';if(c.createdAt&&!Number.isNaN(Date.parse(c.createdAt)))time=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(c.createdAt));return '<article class="comment-entry"><header><span>'+esc(c.author||'随手记录')+'</span>'+(time?'<time>'+esc(time)+'</time>':'')+'<button data-delete-comment="'+esc(c.id)+'" aria-label="删除这条记录">×</button></header>'+inlineText('body','记录内容',c.body,{comment:c.id,rows:2,autogrow:true,placeholder:'记录内容'})+'</article>';}).join('');
  return '<form id="commentForm">'+inlineText('commentDraft','记录新信息',p.commentDraft||'',{placeholder:'想法、讨论、进展…也可以直接粘贴图片'})+'<div class="comment-compose-actions"><input data-inline="commentAuthor" aria-label="记录署名" placeholder="署名（选填）" value="'+esc(p.commentAuthor||'')+'"><button class="primary" type="submit">记一条</button></div></form><div class="comment-entries">'+entries+'</div>';
}
function bindHoverMenus(){
  const timers=new WeakMap();
  const setOpen=(menu,open)=>{menu.toggleAttribute('open',open);menu.querySelector('.menu-trigger').setAttribute('aria-expanded',String(open));};
  const enter=e=>{if(e.pointerType==='touch')return;const menu=e.target.closest('.detail-menu');if(!menu)return;clearTimeout(timers.get(menu));document.querySelectorAll('.detail-menu[open]').forEach(other=>{if(other!==menu&&!other.contains(document.activeElement))setOpen(other,false);});setOpen(menu,true);};
  document.addEventListener('pointerover',enter);document.addEventListener('mouseover',enter);
  document.addEventListener('mousemove',()=>{document.querySelectorAll('.detail-menu:hover').forEach(menu=>setOpen(menu,true));},{passive:true});
  document.addEventListener('pointerout',e=>{const menu=e.target.closest('.detail-menu');if(!menu||menu.contains(e.relatedTarget))return;clearTimeout(timers.get(menu));timers.set(menu,setTimeout(()=>{if(!menu.contains(document.activeElement)&&!menu.matches(':hover'))setOpen(menu,false);},180));});
  document.addEventListener('focusin',e=>{const menu=e.target.closest('.detail-menu');if(menu){clearTimeout(timers.get(menu));setOpen(menu,true);}});
  document.addEventListener('focusout',e=>{const menu=e.target.closest('.detail-menu');if(menu&&!menu.contains(e.relatedTarget))setTimeout(()=>{if(!menu.matches(':hover')&&!menu.contains(document.activeElement))setOpen(menu,false);},180);});
  document.addEventListener('click',e=>{const trigger=e.target.closest('.menu-trigger');if(trigger)setOpen(trigger.parentElement,true);document.querySelectorAll('.detail-menu[open]').forEach(menu=>{if(!menu.contains(e.target))setOpen(menu,false);});});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const menu=e.target.closest('.detail-menu');if(menu){e.stopPropagation();menu.querySelector('.menu-trigger').blur();setOpen(menu,false);}}},true);
}

function inlineText(key,label,value='',options={}){
  const attrs=' data-inline="'+key+'"'+(options.node?' data-node-id="'+esc(options.node)+'"':'')+(options.relation?' data-relation-id="'+esc(options.relation)+'"':'')+(options.section?' data-section-id="'+esc(options.section)+'"':'')+(options.comment?' data-comment-id="'+esc(options.comment)+'"':'')+(options.autogrow?' data-autogrow':'')+' aria-label="'+esc(label)+'"';
  if(options.type)return '<label class="inline-field"><span>'+esc(label)+'</span><input'+attrs+' class="inline-input" type="'+options.type+'" value="'+esc(value)+'" placeholder="'+esc(options.placeholder||'未填写')+'"></label>';
  if(!options.title&&['description','result','impact','body','note','context','commentDraft'].includes(key)){
    const p=byId[state.detail];
    const target=options.section?p?.customSections?.find(s=>s.id===options.section):options.comment?p?.comments?.find(c=>c.id===options.comment):options.node?p?.planNodes?.find(n=>n.id===options.node):options.relation?state.relations.find(r=>r.id===options.relation):p;
    return '<div class="inline-field"><span>'+esc(label)+'</span>'+richEditorMarkup({value,html:target?.richText?.[key]||'',label,placeholder:options.placeholder||'点击填写，支持粘贴图片',attrs})+'</div>';
  }
  return '<label class="inline-field'+(options.title?' inline-title':'')+'"><span'+(options.title?' class="sr-only"':'')+'>'+esc(label)+'</span><textarea'+attrs+' class="inline-text" rows="'+(options.rows||2)+'" placeholder="'+esc(options.placeholder||'点击填写')+'">'+esc(value)+'</textarea></label>';
}
function inlinePlan(n,total){
  const p=byId[state.detail];
  return '<div class="inline-plan" data-plan="'+esc(n.id)+'">'+inlineText('title','计划事项',n.title,{node:n.id,rows:1,placeholder:'如：补充数据并确认验收范围'})+'<button class="row-delete" data-inline-delete-node="'+esc(n.id)+'" aria-label="移除这条计划">×</button>'+inlineText('owner','跟进人',n.owner,{node:n.id,type:'text'})+deliveryPlanMarkup(p,n)+(total>1?'<div class="plan-options"><label title="卡片优先显示延期计划，其余按日期排列"><input type="checkbox" data-inline="focus" data-node-id="'+esc(n.id)+'"'+(n.focus?' checked':'')+'>关注这条计划</label></div>':'')+inlineText('note','补充说明',n.note,{node:n.id,rows:1,placeholder:'选填'})+'</div>';
}
function inlineRelations(pid){
  const blocks=[];
  for(const [key,title,other] of [['main','关联小项目','child'],['child','所属主项目','main']]){
    const links=state.relations.filter(r=>r[key]===pid);if(!links.length&&key!=='main')continue;
    blocks.push({key:key==='main'?'children':'parents',body:(key==='main'?childSectionActionsMarkup():'')+links.map(r=>{const p=byId[r[other]];return '<div class="relation-row"><button class="related-card" data-related="'+esc(p.id)+'"><strong>'+esc(p.name)+'<span>↗</span></strong>'+(p.outcome?'<small>'+esc(p.outcome)+'</small>':'')+((isClosedProject(p)?p.result:p.description)?'<small class="shared-result">'+esc(isClosedProject(p)?p.result:displayDescription(p.description))+'</small>':'')+'</button>'+inlineText('context','这项关联的说明',r.context,{relation:r.id,rows:2,placeholder:'可选：它与本方向有什么关系'})+'<div class="row-actions">'+(r.draft?'<button class="draft-badge" data-confirm-relation="'+esc(r.id)+'">待确认 · 点击确认</button>':'<span></span>')+'<button class="text-action" data-remove-relation="'+esc(r.id)+'">解除关联</button></div></div>';}).join('')});
  }
  return blocks;
}
function directionHistory(p){
  const data=documentData();data.relations=data.relations.filter(r=>!r.draft);const rows=collectDirectionResults(p.id,data).filter(r=>r.closed);if(!rows.length)return null;
  return {key:'history',body:rows.map(({project:r,outcomeKind:kind,relations})=>'<div class="direction-result"><span class="outcome-chip '+kind+'">'+esc(r.outcome||'已结束')+'</span><button data-related="'+esc(r.id)+'">'+esc(r.name)+'</button><p>'+esc(r.result||'待补充结果')+'</p>'+relations.filter(link=>link.context).map(link=>'<small>'+esc(link.context)+'</small>').join('')+'</div>').join('')};
}
function openDetail(pid,instanceId=null,resetScroll=true){
  if(canvasEditor?.clear()===false)return;
  if(!flushRichEditors($('detailBody')))return;
  if(flowEditor?.flush()===false)return;
  if(state.detail&&state.detail!==pid&&!flushInline())return;
  const p=byId[pid];if(!p)return;const scroll=$('detailBody').scrollTop;state.detail=pid;state.detailInstance=instanceId||null;
  const instance=state.instances.find(i=>i.id===instanceId&&i.pid===pid),nodes=visibleNodes(p);
  const detailBlocks=projectDetailSections(p,nodes),availableSections=detailBlocks.map(block=>block.key);
  const additions=actionButton('新栏目','section-add')+actionButton('计划','inline-node-add')+actionButton('资料链接','material-add')+actionButton('小项目','children-show')+actionButton('所属主项目','relation-add-child')+actionButton('放到其他画板分组','reference')+(instance?actionButton('本处备注与重点','placement',instance.id):'')+detailRestoreMenu(p,availableSections);
  let html='<div class="detail-title-tools"><label class="kind-select"><select data-inline="kind" aria-label="项目类型"><option value="project"'+(p.kind!=='direction'?' selected':'')+'>项目</option><option value="direction"'+(p.kind==='direction'?' selected':'')+'>长期方向</option></select></label><div class="detail-toolbar">'+actionButton('小项目 ＋','children-show')+detailMenu('＋ 添加',additions)+detailMenu('•••',actionButton('删除项目','project-delete'))+'</div></div>';
  html+='<div class="project-title-editor">'+inlineText('name','项目标题',p.name,{title:true,rows:1,autogrow:true})+'<button type="button" data-edit-project-title aria-label="修改项目标题">✎ 改标题</button></div>';
  const closed=isClosedProject(p);
  html+='<div class="detail-edit-properties"><label><span>优先级</span>'+priorityControl(p)+'</label><label class="free-status"><span>结果状态</span><input class="inline-input" data-inline="outcome" aria-label="结果状态" value="'+esc(p.outcome||'')+'" placeholder="自由填写"></label><button class="project-lifecycle" data-toggle-closed>'+ (closed?'↺ 恢复跟进':'结束项目')+'</button></div>';
  html+=flowMarkup(p);
  const deliverySummary=deliveryCardMarkup(p);if(deliverySummary)html+='<div class="detail-delivery-summary">'+deliverySummary+'<button type="button" data-delivery-plan-jump>查看交付计划 ↓</button></div>';
  const tagForm='<form id="projectTagForm" class="inline-form"><label class="sr-only" for="projectTagName">添加或新建标签</label><input id="projectTagName" list="tagSuggestions" placeholder="选择或输入新标签" maxlength="40" required autocomplete="off"><datalist id="tagSuggestions">'+state.tagDefinitions.filter(t=>!p.tagIds.includes(t.id)).map(t=>'<option value="'+esc(t.name)+'"></option>').join('')+'</datalist><button type="submit">添加</button></form>';
  html+='<div class="detail-tags">'+rankedTagIds(p.tagIds).map(id=>tagMarkup(id,true)).join('')+detailMenu('＋ 标签',tagForm)+'</div>';
  const sectionKeys=visibleDetailSections(p,availableSections);
  html+=sectionKeys.map(key=>projectSectionMarkup(p,detailBlocks.find(block=>block.key===key),sectionKeys)).join('');
  html+='<div class="detail-section-additions"><button class="add-section" data-action="section-add">＋ 添加栏目</button>'+(!nodes.length?'<button class="inline-add-plan" data-action="inline-node-add">＋ 添加计划</button>':'')+(detailLayout(p).hidden.some(key=>availableSections.includes(key))?detailMenu('＋ 加回栏目',detailRestoreMenu(p,availableSections)):'')+'</div>';
  if(instance&&(instance.focus||instance.context))html+=section('本处备注',(instance.focus?'<p>★ 本处重点</p>':'')+(instance.context?'<div class="rich-content">'+richHTML(instance.richText?.context,instance.context)+'</div>':''),actionButton('编辑','placement',instance.id));
  html+='<details class="board-membership"><summary>行动看板 <span>'+state.quickBoards.filter(b=>b.projectIds.includes(pid)).map(b=>esc(b.name)).join(' · ')+'</span></summary><div>'+state.quickBoards.map(b=>'<label><input type="checkbox" data-project-board="'+esc(b.id)+'"'+(b.projectIds.includes(pid)?' checked':'')+'><span class="nav-color" style="background:'+esc(b.color)+'"></span>'+esc(b.name)+'</label>').join('')+'</div></details>';
  $('detailBody').querySelectorAll('[data-inline]').forEach(el=>{clearTimeout(inlineTimers.get(el));inlineTimers.delete(el);});flowEditor?.destroy();destroyRichEditors($('detailBody'));$('detailBody').innerHTML=html;mountRichEditors($('detailBody'),{onError:toast});flowEditor=mountProjectFlow($('detailBody'),{getProject:()=>byId[pid],mutate:(fn,message,options)=>mutateFlow(pid,fn,message,options),toast,onChange:({kind})=>{if(kind==='current')openDetail(pid,state.detailInstance,false);}});$('detail').hidden=false;$('detailBody').scrollTop=resetScroll?0:scroll;resizeInlineFields();syncActiveProject();if(resetScroll){$('closeDetail').focus({preventScroll:true});revealActiveProject();}
  $('projectTagForm').addEventListener('submit',e=>{e.preventDefault();const name=$('projectTagName').value.trim();if(!name)return;mutate(()=>{let t=state.tagDefinitions.find(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(!t){t={id:uid('tag'),name,color:'#8a8982',rank:Math.max(-1,...state.tagDefinitions.map(t=>t.rank||0))+1};state.tagDefinitions.push(t);}if(!byId[pid].tagIds.includes(t.id))byId[pid].tagIds.push(t.id);},'标签已添加');});
}
function closeDetail(){if(!flushInline())return;state.detail=null;state.detailInstance=null;$('detail').hidden=true;workbench?.render();syncActiveProject();}
function field(name,label,value='',type='text',extra=''){return '<label class="form-field"><span>'+label+'</span><input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';}
function area(name,label,value='',rows=3){return '<label class="form-field"><span>'+label+'</span><textarea name="'+name+'" rows="'+rows+'">'+esc(value)+'</textarea></label>';}
function selectField(name,label,value,options){return '<label class="form-field"><span>'+label+'</span><select name="'+name+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>';}
function check(name,label,value){return '<label class="check-field"><input name="'+name+'" type="checkbox"'+(value?' checked':'')+'>'+label+'</label>';}
function editor(title,html,onSubmit,button='保存'){lastEditor=onSubmit;destroyRichEditors($('editorFields'));$('editorTitle').textContent=title;$('editorFields').innerHTML=html;mountRichEditors($('editorFields'),{onError:toast});$('editorSubmit').textContent=button;$('editorSubmit').disabled=false;$('editorError').hidden=true;if(!$('editorDialog').open)$('editorDialog').showModal();}
function richArea(name,label,value='',html=''){return '<div class="form-field"><span>'+esc(label)+'</span>'+richEditorMarkup({value,html,label,placeholder:'输入内容，或直接粘贴图片…',attrs:'data-rich-name="'+esc(name)+'"'})+'</div>';}
function projectEditor(pid=null){
  const creatingClosed=!pid&&state.display==='results';
  const p=byId[pid]||{name:'',kind:'project',priority:'',description:'',outcome:''};
  const resultFields=creatingClosed?richArea('result','解决 / 牵引了什么问题')+richArea('impact','影响与证据说明')+field('closedAt','结束日期（选填）','','date'):'';
  editor(pid?'编辑项目':creatingClosed?'记录已结项目':'新建项目',field('name','标题',p.name,'text','required maxlength="180"')+'<div class="form-grid">'+selectField('kind','呈现为',p.kind,[['project','项目'],['direction','长期方向']])+field('priority','项目优先级',p.priority,'text','list="priorities" placeholder="可留空，自由填写"')+'</div><datalist id="priorities"><option>P0</option><option>P1</option><option>P2</option></datalist>'+richArea('description','问题陈述',p.description,p.richText?.description)+resultFields+field('outcome','结果状态',p.outcome,'text','placeholder="自由填写，可留空"'),form=>{
    const name=form.get('name').trim();if(!name)throw Error('标题不能为空');let nextId=pid;
    const ok=mutate(()=>{
      const values=Object.fromEntries(['name','kind','priority','description','outcome'].map(k=>[k,form.get(k).trim()]));
      values.richText={...(p.richText||{}),description:form.get('_rich:description')||''};
      if(pid)Object.assign(byId[pid],values);
      else{
        nextId=uid('project');
        const project={id:nextId,...values,status:'',summary:'',result:creatingClosed?(form.get('result')||'').trim():'',impact:creatingClosed?(form.get('impact')||'').trim():'',closed:creatingClosed,closedAt:creatingClosed?form.get('closedAt')||'':'',comments:[],customSections:[],tagIds:[],planNodes:[],materials:[]};
        project.flow=readProjectFlow(project);
        if(!creatingClosed)setCurrentFlowNode(project,'start');
        if(creatingClosed){project.richText.result=form.get('_rich:result')||'';project.richText.impact=form.get('_rich:impact')||'';}
        state.projects.push(project);
        const pos=toWorld(viewport.getBoundingClientRect().left+80,viewport.getBoundingClientRect().top+70);
        state.instances.push({id:uid('place'),pid:nextId,x:pos.x,y:pos.y,context:'',focus:false});
        state.query='';state.tags.clear();state.scopeFrame=null;$('search').value='';
      }
    },creatingClosed?'已记入成果与历史':'项目已更新',{rollbackOnSaveFailure:true});
    if(ok)openDetail(nextId);return ok;
  },creatingClosed?'记录成果':'保存');
}
function showChildren(pid,instanceId=null){
  if(!flushInline())return;
  const p=byId[pid];if(!p)return;
  if(detailLayout(p).hidden.includes('children')&&!mutate(()=>setDetailSectionHidden(p,'children',false),'',{keepDetail:true}))return;
  openDetail(pid,instanceId||(state.detail===pid?state.detailInstance:null),false);focusDetailSection('children');
}
function childProjectEditor(parentId){
  if(!flushInline()||!byId[parentId])return;
  editor('新建小项目',field('name','标题','','text','required maxlength="180"')+richArea('description','问题陈述（选填）'),form=>{
    const id=uid('project'),relationId=uid('relation');
    const ok=mutate(()=>{
      const {project,relation}=createChildProject(state,parentId,{id,relationId,name:form.get('name'),description:form.get('description')||'',richDescription:form.get('_rich:description')||''});
      state.projects.push(project);state.relations.push(relation);setDetailSectionHidden(byId[parentId],'children',false);
      const parent=state.instances.find(i=>i.id===state.detailInstance&&i.pid===parentId)||state.instances.find(i=>i.pid===parentId);
      const rect=viewport.getBoundingClientRect(),pos=parent?{x:parent.x+310,y:parent.y}:toWorld(rect.left+80,rect.top+70);
      while(state.instances.some(i=>Math.abs(i.x-pos.x)<200&&Math.abs(i.y-pos.y)<150))pos.y+=190;
      const placement={id:uid('place'),pid:id,...pos,context:'',focus:false};state.instances.push(placement);
      const frame=parent&&state.frames.find(f=>f.members.includes(parent.id));
      if(frame){frame.members.push(placement.id);frame.w=Math.max(frame.w,pos.x-frame.x+300);frame.h=Math.max(frame.h,pos.y-frame.y+190);}
    },'小项目已添加',{rollbackOnSaveFailure:true});
    if(ok)openDetail(id);return ok;
  },'创建');
}
function nodeEditor(pid,nodeId=null){
  if(!flushInline())return;
  if(!nodeId){nodeId=uid('node');if(!mutate(()=>byId[pid].planNodes.push({id:nodeId,title:'',owner:'',targetDate:'',estimatedDate:'',dateConfirmed:false,note:'',status:'',focus:false})))return;}
  deliveryController.edit(pid,nodeId);
}
function materialEditor(pid,materialId=null){const p=byId[pid],m=p.materials.find(m=>m.id===materialId)||{};editor(materialId?'编辑资料链接':'添加资料链接',field('title','名称',m.title,'text','placeholder="选填"')+field('url','链接',m.url,'url','required placeholder="https://…"')+(materialId?'<button class="danger-link" type="button" data-editor-remove="material">删除此链接</button>':''),f=>mutate(()=>{const url=safeURL(f.get('url').trim());if(!url)throw Error('请输入有效的 http 或 https 链接');const v={id:materialId||uid('material'),title:f.get('title').trim()||new URL(url).hostname,url};if(materialId)Object.assign(byId[pid].materials.find(m=>m.id===materialId),v);else byId[pid].materials.push(v);setDetailSectionHidden(byId[pid],'materials',false);},'资料已更新'));editorInstance={pid,materialId};}
function relationEditor(pid,key='main',relationId=null){const r=state.relations.find(r=>r.id===relationId),other=key==='main'?'child':'main';const selected=r?.[other]||'';editor(relationId?'编辑主小项目关联':key==='main'?'关联一个小项目':'挂载到主项目',(r?'<p class="muted">'+esc(byId[r.main].name)+' → '+esc(byId[r.child].name)+'</p>':selectField('other',key==='main'?'选择小项目':'选择主项目',selected,[['','请选择'],...projects.filter(p=>p.id!==pid).map(p=>[p.id,p.name])]))+richArea('context','此关联的说明（选填）',r?.context||'',r?.richText?.context)+(r?.draft&&r.rationale?'<details class="draft-reason"><summary>为什么建议这条关联</summary><p>'+esc(r.rationale)+'</p></details>':'')+(r?check('confirmed','关联已确认',!r.draft):'')+(r?'<button class="danger-link" type="button" data-editor-remove="relation">解除关联，保留项目</button>':''),f=>mutate(()=>{if(r){const current=state.relations.find(v=>v.id===relationId);current.context=f.get('context').trim();current.richText={...(current.richText||{}),context:f.get('_rich:context')||''};current.draft=!f.has('confirmed');}else{const target=f.get('other');if(!target)throw Error('请选择项目');const main=key==='main'?pid:target,child=key==='main'?target:pid;if(state.relations.some(r=>r.main===main&&r.child===child))throw Error('这两个项目已有关联');state.relations.push({id:uid('relation'),main,child,context:f.get('context').trim(),richText:{context:f.get('_rich:context')||''},draft:false});setDetailSectionHidden(byId[pid],key==='main'?'children':'parents',false);}},'关联已更新'));editorInstance={relationId};}
function placementEditor(id){const i=state.instances.find(i=>i.id===id);editor('调整此处展示','<p class="muted">'+esc(byId[i.pid].name)+'</p>'+check('focus','此处标为重点',i.focus)+richArea('context','本处讨论备注',i.context,i.richText?.context)+'<button class="danger-link" type="button" data-editor-remove="placement">移除此处引用，保留项目</button>',f=>mutate(()=>{const current=state.instances.find(v=>v.id===id);current.focus=f.has('focus');current.context=f.get('context').trim();current.richText={...(current.richText||{}),context:f.get('_rich:context')||''};},'本处展示已更新'));editorInstance={placementId:id};}
function referenceEditor(pids=[],frameId=''){editor('放到画板','<p class="muted">同一项目可放在多个分组；内容仍只维护一份。</p>'+(pids.length?'':selectField('pid','项目','',[['','请选择项目'],...projects.map(p=>[p.id,p.name])]))+selectField('frame','放置位置',frameId,[['','自由区域'],...state.frames.map(f=>[f.id,f.name])]),f=>{const ids=pids.length?pids:[f.get('pid')];if(!ids[0])throw Error('请选择项目');return mutate(()=>{const frame=state.frames.find(g=>g.id===f.get('frame'));ids.forEach(pid=>{let x,y;if(frame){const k=frame.members.length;x=frame.x+16+(k%2)*300;y=frame.y+16+Math.floor(k/2)*182;frame.w=Math.max(frame.w,616);frame.h=Math.max(frame.h,Math.ceil((k+1)/2)*182+24);}else{const b=viewport.getBoundingClientRect(),pos=toWorld(b.left+80,b.top+70);x=pos.x;y=pos.y;}const i={id:uid('place'),pid,x,y,context:'',focus:false};state.instances.push(i);if(frame)frame.members.push(i.id);});},'已放到画板');});}
function deleteProject(pid){deliveryController.deleteProject(pid,()=>{
  const ids=new Set(projectInstances(pid).map(i=>i.id));state.detail=null;state.detailInstance=null;$('detail').hidden=true;
  state.projects=state.projects.filter(p=>p.id!==pid);state.instances=state.instances.filter(i=>i.pid!==pid);state.relations=state.relations.filter(r=>r.main!==pid&&r.child!==pid);state.frames.forEach(f=>f.members=f.members.filter(id=>!ids.has(id)));state.quickBoards.forEach(b=>{b.projectIds=b.projectIds.filter(id=>id!==pid);b.emphasisIds=b.emphasisIds.filter(id=>id!==pid);delete b.contexts?.[pid];});
});}
function tagRows(){ $('tagRows').innerHTML=orderedTags(state.tagDefinitions).map(t=>'<form class="tag-row" data-tag-row="'+esc(t.id)+'" tabindex="0" aria-label="分类标签：'+esc(t.name)+'" title="拖动空白处排序；Alt + 方向键也可移动">'+colorPickerMarkup(t.color,'data-tag-color',t.id,t.name+'颜色',{name:'color'})+'<input name="name" data-tag-name="'+esc(t.id)+'" value="'+esc(t.name)+'" aria-label="标签名称：'+esc(t.name)+'" title="直接修改，Enter 或移开焦点保存；Esc 取消" maxlength="40" required><button type="button" data-delete-tag="'+esc(t.id)+'" aria-label="删除标签'+esc(t.name)+'">删除</button></form>').join(''); }
function openTags(){if(!tagEditor?.flush())return;tagRows();if(!$('tagDialog').open)$('tagDialog').showModal();}
function previewMaterial(pid,id){const m=byId[pid].materials.find(m=>m.id===id);if(!m||!safeURL(m.url))return;$('previewTitle').textContent=m.title||'资料';$('previewOriginal').href=safeURL(m.url);$('previewFrame').src=safeURL(m.url);$('previewDialog').showModal();}
function addReferences(pids){referenceEditor([...new Set(pids)]);}
function removeFrame(id){mutate(()=>{state.frames=state.frames.filter(f=>f.id!==id);if(state.scopeFrame===id)state.scopeFrame=null;},'分组已取消，项目保留');}
function reconcileMembership(ids,frames=state.frames){for(const f of frames){f.members=f.members.filter(id=>!ids.includes(id));for(const id of ids){const i=state.instances.find(i=>i.id===id),b=boxFor(i),cx=b.x+b.w/2,cy=b.y+b.h/2;if(cx>=f.x&&cx<=f.x+f.w&&cy>=f.y&&cy<=f.y+f.h)f.members.push(id);}}}
function scatter(){state.mode='highlight';applyFilter();renderSelection();}
function closeOrCancel(){if(!document.querySelector('dialog[open]')){if(document.body.classList.contains('sidebar-open'))toggleSidebar(false);else if(state.detail)closeDetail();else if(state.mode==='gather')scatter();else{state.selected.clear();state.selectedFrames.clear();renderSelection();setTool('select');}}}
function commitInline(el){
  clearTimeout(inlineTimers.get(el));inlineTimers.delete(el);
  if(!el?.dataset.pending)return true;
  const pid=el.dataset.editingPid||state.detail,p=byId[pid];if(!p)return false;
  const rich=el.classList.contains('rich-editor-input')?readRichEditor(el):null;
  const key=el.dataset.inline,value=rich?rich.text:el.type==='checkbox'?el.checked:el.value;
  if(el.dataset.layoutKey){const ok=mutate(()=>renameDetailSection(p,el.dataset.layoutKey,value),'',{keepDetail:true});if(ok){delete el.dataset.pending;el.removeAttribute('aria-invalid');}return ok;}
  const target=el.dataset.sectionId?(p.customSections||[]).find(s=>s.id===el.dataset.sectionId):el.dataset.commentId?(p.comments||[]).find(c=>c.id===el.dataset.commentId):el.dataset.nodeId?p.planNodes.find(n=>n.id===el.dataset.nodeId):el.dataset.relationId?state.relations.find(r=>r.id===el.dataset.relationId):p;
  if(!target)return false;
  if(key==='name'&&!value.trim()){el.setAttribute('aria-invalid','true');toast('项目标题不能为空');return false;}
  if(target[key]===value&&(!rich||target.richText?.[key]===rich.html)){if(dirty&&!save(false))return false;delete el.dataset.pending;return true;}
  const ok=mutate(()=>{target[key]=value;if(rich){target.richText??={};target.richText[key]=rich.html;}if(key==='focus'&&value)p.planNodes.filter(n=>n.id!==el.dataset.nodeId).forEach(n=>n.focus=false);if(el.dataset.commentId)target.updatedAt=new Date().toISOString();},'',{keepDetail:true});
  if(ok){delete el.dataset.pending;el.removeAttribute('aria-invalid');if(key==='focus')$('detailBody').querySelectorAll('[data-inline="focus"]').forEach(box=>box.checked=!!p.planNodes.find(n=>n.id===box.dataset.nodeId)?.focus);}return ok;
}
function flushInline(){if(tagEditor?.flush()===false)return false;if(!flushRichEditors($('detailBody')))return false;let ok=flowEditor?.flush()!==false;if(canvasEditor?.flush()===false)ok=false;document.querySelectorAll('[data-inline][data-pending]').forEach(el=>{if(!commitInline(el))ok=false;});if(workbench?.flush()===false)ok=false;return ok;}
function navigate(display,board=null){
  if(!flushInline())return;closeDetail();state.activeBoard=board;state.scopeFrame=null;state.tags.clear();state.query='';$('search').value='';renderTags();setDisplay(display);if(mobile())toggleSidebar(false);
}
function setDisplay(display){
  if(!flushInline())return;canvasEditor?.clear();if(mobile()&&display==='canvas')display='list';state.display=display;
  if(display!=='boards')state.activeBoard=null;
  $('newProject').textContent=display==='results'?'＋ 记录已结项目':'＋ 新项目';
  document.body.classList.toggle('delivery-screen',display==='delivery');
  document.body.classList.toggle('list-view',display==='list');document.body.classList.toggle('workbench-screen',['boards','results','delivery'].includes(display));
  for(const [id,value] of [['boardsView','boards'],['canvasView','canvas'],['listView','list']]){$(id).classList.toggle('active',value===display);$(id).setAttribute('aria-pressed',String(value===display));}
  const board=state.quickBoards.find(b=>b.id===state.activeBoard);
  $('pageTitle').textContent=display==='delivery'?'延期记录':display==='results'?'成果与历史':display==='boards'?(board?.name||'推进总览'):display==='canvas'?'自由画板':'项目列表';
  state.mode='highlight';state.selected.clear();state.selectedFrames.clear();applyFilter();renderSelection();workbench?.renderNav();canvasEditor?.sync();
}
function undoWithDeliveryHistory(){
  if(!flushInline())return;
  if(dirty){toast('有未保存的修改，请先重试保存或导出备份。');return;}
  try{
    const previous=storage.peekUndo();if(!previous)return;
    const preview=previewDeliveryUndo(documentData(),previous);
    const apply=(reason='',actor='')=>{
      const current=clone(documentData());
      const prev=storage.undo({transform:candidate=>{
        const next=applyDeliveryUndo(current,candidate,{reason,actor});
        recordDeliveryLifecycle(next,current,{actor});reconcileDelivery(next);return next;
      }});
      if(!prev)return false;
      restoreData(prev);state.selected.clear();state.selectedFrames.clear();if(!byId[state.detail]){state.detail=null;state.detailInstance=null;$('detail').hidden=true;}renderAll();setSaveStatus(true);$('undo').disabled=!storage.canUndo();if($('tagDialog').open)tagRows();toast('已撤销，交付历史保留');return true;
    };
    if(preview.requiresReason){
      editor('撤销交付变更','<p class="muted">这次撤销涉及交付日期或记录。填写原因后撤销，原记录继续保留。</p><ul class="delivery-undo-list">'+preview.changes.map(c=>'<li>'+esc(c.projectName)+' · '+esc(c.nodeTitle||'未命名计划')+(c.fromDate||c.toDate?'：'+esc(c.fromDate||'未设置')+' → '+esc(c.toDate||'未设置'):'')+'</li>').join('')+'</ul>'+area('reason','撤销理由')+field('actor','记录人（选填）'),f=>{const reason=f.get('reason').trim();if(!reason)throw Error('请填写撤销理由');return apply(reason,f.get('actor').trim());},'撤销并留档');
    }else apply();
  }catch(e){toast('撤销失败：'+e.message);}
}
function bindDeliveryActions(){
  $('deliveryReminder').addEventListener('click',()=>{state.deliveryFilter='active';state.deliveryQuery='';navigate('delivery');});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-delivery-edit],[data-delivery-complete],[data-delivery-reopen],[data-delivery-history],[data-delivery-open],[data-delivery-filter],[data-delivery-plan-jump]');if(!b)return;
    e.stopPropagation();
    if(!flushInline())return;
    const pid=b.dataset.projectId;
    if(b.hasAttribute('data-delivery-plan-jump')){const p=byId[state.detail];if(p&&detailLayout(p).hidden.includes('plans'))mutate(()=>setDetailSectionHidden(p,'plans',false));focusDetailSection('plans');}
    else if(b.hasAttribute('data-delivery-edit'))deliveryController.edit(pid,b.dataset.deliveryEdit);
    else if(b.hasAttribute('data-delivery-complete'))deliveryController.complete(pid,b.dataset.deliveryComplete);
    else if(b.hasAttribute('data-delivery-reopen'))deliveryController.reopen(pid,b.dataset.deliveryReopen);
    else if(b.hasAttribute('data-delivery-history')){state.deliveryFilter='history';state.deliveryQuery=byId[pid]?.name||'';navigate('delivery');}
    else if(b.hasAttribute('data-delivery-filter')){state.deliveryFilter=b.dataset.deliveryFilter;workbench.render();}
    else if(b.hasAttribute('data-delivery-open')){openDetail(b.dataset.deliveryOpen);const node=[...$('detailBody').querySelectorAll('[data-plan]')].find(el=>el.dataset.plan===b.dataset.nodeId);node?.scrollIntoView({block:'nearest'});}
  });
  document.addEventListener('input',e=>{
    if(!e.target.matches('[data-delivery-search]'))return;
    const input=e.target,start=input.selectionStart,end=input.selectionEnd;state.deliveryQuery=input.value;
    workbench.render();const next=document.querySelector('[data-delivery-search]');next?.focus({preventScroll:true});next?.setSelectionRange(start,end);
  });
  let observedDay=todayDate();
  function refreshClock(){
    if(!state||document.hidden||observedDay===todayDate()||document.querySelector('dialog[open]')||document.activeElement?.closest('input,textarea,[contenteditable="true"]'))return;
    if(!flushInline())return;const before=clone(documentData());
    try {reconcileDelivery(state);if(!save(false)){restoreData(before);return;}observedDay=todayDate();renderAll();}
    catch(error){restoreData(before);toast(error.message);}
  }
  window.addEventListener('focus',refreshClock);document.addEventListener('visibilitychange',refreshClock);setInterval(refreshClock,60000);
}
function bindProjectContent(){
  $('detailBody').addEventListener('submit',e=>{
    if(e.target.id!=='commentForm')return;e.preventDefault();if(!flushInline())return;
    const p=byId[state.detail],body=(p.commentDraft||'').trim();if(!body){e.target.querySelector('[data-inline="commentDraft"]').focus();return;}
    mutate(()=>{p.comments.push({id:uid('comment'),body,richText:{body:p.richText?.commentDraft||''},author:(p.commentAuthor||'').trim(),createdAt:new Date().toISOString()});p.commentDraft='';if(p.richText)delete p.richText.commentDraft;},'已记入评论池');
    $('commentForm')?.querySelector('[data-inline="commentDraft"]').focus();
  });
  $('detailBody').addEventListener('click',e=>{
    const action=e.target.closest('[data-edit-project-title],[data-section-rename],[data-move-section],[data-hide-section],[data-restore-section],[data-toggle-closed],[data-delete-section],[data-delete-comment],[data-action="section-add"]');if(!action)return;if(!flushInline())return;
    const p=byId[state.detail],pid=p.id;
    if(action.hasAttribute('data-edit-project-title')){const title=$('detailBody').querySelector('[data-inline="name"]');title?.focus();title?.select();return;}
    if(action.hasAttribute('data-section-rename')){focusDetailSection(action.dataset.sectionRename,true);return;}
    if(action.hasAttribute('data-move-section')){const key=action.dataset.moveSection,step=Number(action.dataset.step),keys=[...$('detailBody').querySelectorAll('[data-detail-section]')].map(el=>el.dataset.detailSection);mutate(()=>moveDetailSection(p,key,step,keys));focusDetailSection(key);return;}
    if(action.hasAttribute('data-hide-section')){const key=action.dataset.hideSection,title=detailSectionTitle(p,key),keys=[...$('detailBody').querySelectorAll('[data-detail-section]')].map(el=>el.dataset.detailSection),index=keys.indexOf(key),next=keys[index+1]||keys[index-1];if(mutate(()=>setDetailSectionHidden(p,key,true))){focusDetailSection(next);detailUndo('已隐藏「'+title+'」，内容保留',()=>{if(!flushInline()||!byId[pid])return;mutate(()=>setDetailSectionHidden(byId[pid],key,false),'栏目已加回');if(state.detail===pid)focusDetailSection(key);});}return;}
    if(action.hasAttribute('data-restore-section')){const key=action.dataset.restoreSection;mutate(()=>setDetailSectionHidden(p,key,false),'栏目已加回');focusDetailSection(key);return;}
    if(action.hasAttribute('data-toggle-closed')){const closed=!isClosedProject(p);mutate(()=>{setProjectClosed(p,closed);if(closed)setDetailSectionHidden(p,'result',false);},closed?'项目已结束，可以填写成果记录':'已恢复跟进');if(closed)focusDetailSection('result');return;}
    if(action.hasAttribute('data-delete-section')){const id=action.dataset.deleteSection;let removed;const keys=[...$('detailBody').querySelectorAll('[data-detail-section]')].map(el=>el.dataset.detailSection),index=keys.indexOf('custom:'+id),next=keys[index+1]||keys[index-1];if(mutate(()=>removed=removeCustomSection(p,id))&&removed){focusDetailSection(next);detailUndo('已删除「'+(removed.section.title||'未命名栏目')+'」',()=>{if(!flushInline()||!byId[pid])return;mutate(()=>restoreCustomSection(byId[pid],removed),'栏目已恢复');if(state.detail===pid)focusDetailSection('custom:'+id,true);});}return;}
    if(action.hasAttribute('data-delete-comment')){const index=p.comments.findIndex(c=>c.id===action.dataset.deleteComment),comment=p.comments[index];if(!comment)return;if(mutate(()=>p.comments.splice(index,1))){$('commentForm')?.querySelector('[data-inline="commentDraft"]').focus();detailUndo('记录已删除',()=>{if(!flushInline()||!byId[pid])return;mutate(()=>{const current=byId[pid];if(!current.comments.some(c=>c.id===comment.id))current.comments.splice(Math.min(index,current.comments.length),0,comment);},'记录已恢复');});}return;}
    const id=uid('section');mutate(()=>p.customSections.push({id,title:'',body:''}),'已添加栏目');focusDetailSection('custom:'+id,true);
  });
}
function bindInlineEditing(){
  $('detailBody').addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-inline]'))return;if(e.isComposing)return;if(el.matches('textarea[data-autogrow]')){el.style.height='0px';el.style.height=Math.max(el.closest('.inline-title')?0:el.classList.contains('comment-draft')?56:72,el.scrollHeight+2)+'px';}el.dataset.pending='true';el.dataset.editingPid=state.detail;$('saveStatus').textContent='正在编辑…';$('detailSaveStatus').textContent='正在编辑…';clearTimeout(inlineTimers.get(el));inlineTimers.set(el,setTimeout(()=>commitInline(el),700));});
  $('detailBody').addEventListener('focusout',e=>{if(e.target.matches('[data-inline][data-pending]'))commitInline(e.target);});
  $('detailBody').addEventListener('change',e=>{
    const el=e.target;if(el.matches('[data-inline]')){el.dataset.pending='true';el.dataset.editingPid=state.detail;commitInline(el);}
    if(el.matches('[data-project-board]'))mutate(()=>{const b=state.quickBoards.find(b=>b.id===el.dataset.projectBoard),pid=state.detail;if(el.checked&&!b.projectIds.includes(pid))b.projectIds.push(pid);else if(!el.checked){b.projectIds=b.projectIds.filter(id=>id!==pid);b.emphasisIds=b.emphasisIds.filter(id=>id!==pid);delete b.contexts?.[pid];}},'',{keepDetail:true});
  });
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-priority-editor]')){mutate(()=>byId[el.dataset.priorityEditor].priority=el.value,'',{keepDetail:!!el.closest('#detailBody')});el.dataset.priority=el.value;}
    if(el.matches('[data-frame-color]'))mutate(()=>state.frames.find(f=>f.id===el.dataset.frameColor).backgroundColor=el.value);
    if(el.matches('[data-selected-frame-color]'))mutate(()=>state.frames.filter(f=>state.selectedFrames.has(f.id)).forEach(f=>f.backgroundColor=el.value));
    if(el.matches('[data-tag-color]'))mutate(()=>tagById[el.dataset.tagColor].color=el.value);
  });
  $('detailBody').addEventListener('click',e=>{
    const add=e.target.closest('[data-action="inline-node-add"]');if(add){if(!flushInline())return;const id=uid('node');mutate(()=>{const p=byId[state.detail];p.planNodes.push({id,title:'',owner:'',targetDate:'',estimatedDate:'',dateConfirmed:false,note:'',status:'',focus:false});setDetailSectionHidden(p,'plans',false);});$('detailBody').querySelector('[data-plan="'+id+'"] textarea')?.focus();}
    const remove=e.target.closest('[data-inline-delete-node]');if(remove)deliveryController.removeNode(state.detail,remove.dataset.inlineDeleteNode);
    const confirm=e.target.closest('[data-confirm-relation]');if(confirm)mutate(()=>state.relations.find(r=>r.id===confirm.dataset.confirmRelation).draft=false,'关联已确认');
    const unlink=e.target.closest('[data-remove-relation]');if(unlink)mutate(()=>state.relations=state.relations.filter(r=>r.id!==unlink.dataset.removeRelation),'关联已解除，项目保留');
  });
}

function toggleSidebar(force){if(mobile()){const open=typeof force==='boolean'?force:!document.body.classList.contains('sidebar-open');document.body.classList.toggle('sidebar-open',open);$('sidebarBackdrop').hidden=!open;$('toggleSidebar').setAttribute('aria-expanded',String(open));}else{const open=typeof force==='boolean'?force:document.body.classList.contains('sidebar-collapsed');document.body.classList.toggle('sidebar-collapsed',!open);$('toggleSidebar').setAttribute('aria-expanded',String(open));}}
const snapshots = createSnapshotStore({key:storageKey('topic-workbench-snapshots-v1')});
function snapshotsPanel(){
  try{snapshots.list();const date=new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});editor('保存快照',field('snapshotName','名称','画板 · '+date,'text','required')+'<a class="text-action" href="snapshots.html">查看历史快照 →</a>',f=>{if(!flushInline())return false;const name=f.get('snapshotName').trim();if(reconcileDelivery(state))save(false);const snap=snapshots.capture(name,documentData());toast('快照已保存');const link=document.createElement('a');link.href='snapshots.html?snapshot='+encodeURIComponent(snap.id);link.textContent='查看';link.className='toast-undo';$('toast').append(link);},'保存');}catch(error){toast(error.message);}
}
function snapshotPreview(id){location.href='snapshots.html?snapshot='+encodeURIComponent(id);}
function reviewPanel(){
  const data=documentData(),dates=findScheduleConflicts(data),links=findContentOverlaps(data);
  const schedule=dates.map(r=>'<div class="review-row"><strong>'+esc(r.owner)+' · '+esc(r.overlap.start)+(r.overlap.end!==r.overlap.start?' 至 '+esc(r.overlap.end):'')+'</strong>'+r.items.map(i=>'<button type="button" data-review-project="'+esc(i.projectId)+'">'+esc(i.projectName)+' · '+esc(i.nodeTitle)+(i.dateConfirmed?'':' · 日期未确认')+'</button>').join('')+'<p>'+esc(r.reason)+'</p></div>').join('')||'<p class="muted">现有明确负责人及日期中，未发现同日或重叠安排。</p>';
  const related=links.map(r=>'<div class="review-row"><button type="button" data-review-project="'+esc(r.projectId)+'">'+esc(r.projectName)+'</button><p>'+esc((r.parents||r.boards||[]).map(x=>x.name).join(' / '))+'</p></div>').join('')||'<p class="muted">暂无共享关联需要查看。</p>';
  editor('待核对事项','<h3>排期 / 资源</h3>'+schedule+'<h3>关联 / 范围</h3><p class="muted">同一项目可以出现在多处。这里帮助核对各处范围，由你决定是否合并或调整安排。</p>'+related,()=>true,'关闭');
}
function bindEvents(){
installColorPickers();
tagEditor=mountTagEditor({bar:$('tags'),rows:$('tagRows'),getTags:()=>state.tagDefinitions,
  saveName:(id,name)=>{if(!flushInline())return false;return mutate(()=>state.tagDefinitions=renameTag(state.tagDefinitions,id,name),'',{rollbackOnSaveFailure:true});},
  reorder:(id,target,side)=>{if(!flushInline())return false;return mutate(()=>state.tagDefinitions=moveTag(state.tagDefinitions,id,target,side),'',{rollbackOnSaveFailure:true});},
  toggle:id=>{state.tags.has(id)?state.tags.delete(id):state.tags.add(id);if(state.mode==='gather'&&!state.tags.size&&!state.query)state.mode='highlight';$('tags').querySelectorAll('[data-tag]').forEach(b=>{const active=state.tags.has(b.dataset.tag);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});applyFilter();renderSelection();},
  renderBar:renderTags,renderRows:tagRows,notify:toast
});
$('tagDialog').addEventListener('cancel',e=>{if(!tagEditor.flush())e.preventDefault();});

$('newTagColorControl').innerHTML=colorPickerMarkup('#8c8981','data-new-tag-color','new','标签颜色',{inputId:'newTagColor'});
for(const [id,edge] of [['bringFrameFront','front'],['sendFrameBack','back']])$(id).addEventListener('click',()=>{if(!state.selectedFrames.size)return;mutate(()=>state.frames=moveFramesToEdge(state.frames,state.selectedFrames,edge),'',{keepDetail:true,rollbackOnSaveFailure:true});});
mountDetailResize({panel:$('detail'),handle:$('detailResize'),container:document.querySelector('.workspace'),key:storageKey('topic-workbench-detail-width'),onResize:()=>{if(state?.detail)resizeInlineFields();}});
bindInlineEditing();bindProjectContent();bindHoverMenus();bindDeliveryActions();$('jumpComments').addEventListener('click',()=>{if(!flushInline())return;const p=byId[state.detail];if(p&&detailLayout(p).hidden.includes('comments'))mutate(()=>setDetailSectionHidden(p,'comments',false));$('commentForm')?.scrollIntoView({block:'center'});$('commentForm')?.querySelector('[data-inline="commentDraft"]').focus({preventScroll:true});});$('detailSaveStatus').addEventListener('click',()=>{flushInline();save(false);});
$('snapshots').addEventListener('click',snapshotsPanel);$('reviewIssues').addEventListener('click',reviewPanel);
document.addEventListener('click',e=>{const b=e.target.closest('[data-snapshot-read],[data-snapshot-export],[data-snapshot-delete],[data-review-project]');if(!b)return;try{if(b.hasAttribute('data-snapshot-read'))snapshotPreview(b.dataset.snapshotRead);if(b.hasAttribute('data-snapshot-export'))storage.download(snapshots.export(b.dataset.snapshotExport));if(b.hasAttribute('data-snapshot-delete')){const id=b.dataset.snapshotDelete;editor('删除快照','<p>仅删除这份历史快照，当前项目和布局保留。</p>',()=>{snapshots.remove(id);toast('快照已删除');},'确认删除');}if(b.hasAttribute('data-review-project')){$('editorDialog').close();openDetail(b.dataset.reviewProject);}}catch(error){toast(error.message);}});

document.addEventListener('click',e=>{const child=e.target.closest('[data-open-children]');if(child&&!child.closest('#world')){showChildren(child.dataset.openChildren);return;}const b=e.target.closest('[data-open]');if(b&&!b.closest('#world'))openDetail(b.dataset.open);});
window.addEventListener('beforeunload',e=>{if(!flushInline()||!flushRichEditors($('editorFields'))||dirty){e.preventDefault();e.returnValue='';}});
$('toggleSidebar').addEventListener('click',()=>toggleSidebar());$('collapseSidebar').addEventListener('click',()=>toggleSidebar(false));$('sidebarBackdrop').addEventListener('click',()=>toggleSidebar(false));
$('canvasView').addEventListener('click',()=>navigate('canvas'));$('listView').addEventListener('click',()=>navigate('list'));$('boardsView').addEventListener('click',()=>navigate('boards'));$('canvasNav').addEventListener('click',()=>navigate('canvas'));$('resultsNav').addEventListener('click',()=>navigate('results'));$('deliveryNav').addEventListener('click',()=>navigate('delivery'));
$('homeNav').addEventListener('click',()=>navigate('boards'));
$('frameNav').addEventListener('click',e=>{const b=e.target.closest('[data-focus-frame]');if(b){closeDetail();focusFrame(b.dataset.focusFrame);}});

$('search').addEventListener('input',e=>{state.query=e.target.value;applyFilter();});$('logic').addEventListener('change',e=>{state.logic=e.target.value;applyFilter();});
$('highlight').addEventListener('click',()=>{state.mode='highlight';applyFilter();renderSelection();});$('gather').addEventListener('click',()=>{state.mode=state.mode==='gather'?'highlight':'gather';applyFilter();renderSelection();});$('scatter').addEventListener('click',scatter);$('gatherMask').addEventListener('click',scatter);
$('clear').addEventListener('click',()=>{state.scopeFrame=null;state.tags.clear();state.query='';$('search').value='';state.mode='highlight';renderTags();applyFilter();renderSelection();renderFrameNav();});
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));$('groupTool').addEventListener('click',groupSelection);$('groupSelection').addEventListener('click',groupSelection);$('duplicateSelection').addEventListener('click',()=>duplicateInstances([...state.selected]));$('referenceSelection').addEventListener('click',()=>addReferences(state.instances.filter(i=>state.selected.has(i.id)).map(i=>i.pid)));$('clearSelection').addEventListener('click',()=>{state.selected.clear();state.selectedFrames.clear();renderSelection();});$('zoomIn').addEventListener('click',()=>zoom(1.15));$('zoomOut').addEventListener('click',()=>zoom(1/1.15));$('fit').addEventListener('click',fit);
$('closeDetail').addEventListener('click',closeDetail);$('openSettings').addEventListener('click',()=>$('settingsDialog').showModal());$('closeSettings').addEventListener('click',()=>$('settingsDialog').close());$('help').addEventListener('click',()=>$('helpDialog').showModal());$('closeHelp').addEventListener('click',()=>$('helpDialog').close());$('cancelName').addEventListener('click',()=>$('nameDialog').close());
$('nameForm').addEventListener('submit',e=>{e.preventDefault();const name=$('frameName').value.trim();if(!name)return;const ok=mutate(()=>{if(pendingFrame.rename)state.frames.find(f=>f.id===pendingFrame.rename).name=name;else state.frames.push({id:uid('frame'),name,...pendingFrame.bounds,members:pendingFrame.ids,tone:'sand',color:'#b8afa0',backgroundColor:'#e9e8e4'});state.selected.clear();state.selectedFrames.clear();},'分组已更新');if(ok){$('nameDialog').close();setTool('select');}});
$('newProject').addEventListener('click',()=>projectEditor());$('manageTags').addEventListener('click',openTags);$('closeTags').addEventListener('click',()=>{if(tagEditor.flush())$('tagDialog').close();});
$('newTagForm').addEventListener('submit',e=>{e.preventDefault();const name=$('newTagName').value.trim(),color=$('newTagColor').value;if(!name)return;if(state.tagDefinitions.some(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('已有同名标签');return;}mutate(()=>state.tagDefinitions.push({id:uid('tag'),name,color,rank:Math.max(-1,...state.tagDefinitions.map(t=>t.rank||0))+1}),'标签已新增');$('newTagName').value='';tagRows();});
$('tagRows').addEventListener('click',e=>{const b=e.target.closest('[data-delete-tag]');if(!b)return;const id=b.dataset.deleteTag;mutate(()=>{state.tagDefinitions=state.tagDefinitions.filter(t=>t.id!==id);projects.forEach(p=>p.tagIds=p.tagIds.filter(t=>t!==id));state.tags.delete(id);},'标签已删除，可撤销');tagRows();});
$('editorForm').addEventListener('submit',e=>{e.preventDefault();$('editorError').hidden=true;try{if(!flushRichEditors($('editorFields')))return;const form=new FormData(e.target);$('editorFields').querySelectorAll('[data-rich-name]').forEach(el=>{const v=readRichEditor(el);form.set(el.dataset.richName,v.text);form.set('_rich:'+el.dataset.richName,v.html);});if(lastEditor(form)!==false)$('editorDialog').close();else{$('editorError').textContent=$('toast').textContent;$('editorError').hidden=false;}}catch(error){$('editorError').textContent=error.message;$('editorError').hidden=false;}});
document.querySelectorAll('[data-close-editor]').forEach(b=>b.addEventListener('click',()=>$('editorDialog').close()));
$('editorFields').addEventListener('click',e=>{const b=e.target.closest('[data-editor-remove]');if(!b)return;const {pid,nodeId,materialId,relationId,placementId}=editorInstance;if(b.dataset.editorRemove==='node'){deliveryController.removeNode(pid,nodeId);return;}const ok=mutate(()=>{if(b.dataset.editorRemove==='material')byId[pid].materials=byId[pid].materials.filter(m=>m.id!==materialId);if(b.dataset.editorRemove==='relation')state.relations=state.relations.filter(r=>r.id!==relationId);if(b.dataset.editorRemove==='placement'){state.instances=state.instances.filter(i=>i.id!==placementId);state.frames.forEach(f=>f.members=f.members.filter(id=>id!==placementId));state.detailInstance=null;}},'已移除，可撤销');if(ok)$('editorDialog').close();});
$('detailBody').addEventListener('click',e=>{const related=e.target.closest('[data-related]');if(related){openDetail(related.dataset.related);return;}const tag=e.target.closest('[data-detach-tag]');if(tag){mutate(()=>byId[state.detail].tagIds=byId[state.detail].tagIds.filter(t=>t!==tag.dataset.detachTag),'已从此项目移除标签');return;}const frame=e.target.closest('[data-focus-frame]');if(frame){closeDetail();setDisplay('canvas');focusFrame(frame.dataset.focusFrame);return;}const preview=e.target.closest('[data-preview]');if(preview){previewMaterial(state.detail,preview.dataset.preview);return;}const b=e.target.closest('[data-action]');if(!b)return;b.closest('.detail-menu')?.removeAttribute('open');const pid=state.detail,id=b.dataset.id;switch(b.dataset.action){case 'project-edit':projectEditor(pid);break;case 'project-delete':deleteProject(pid);break;case 'tags':openTags();break;case 'node-add':nodeEditor(pid);break;case 'node-edit':nodeEditor(pid,id);break;case 'material-add':materialEditor(pid);break;case 'material-edit':materialEditor(pid,id);break;case 'children-show':showChildren(pid);break;case 'child-create':childProjectEditor(pid);break;case 'relation-add-main':relationEditor(pid,'main');break;case 'relation-add-child':relationEditor(pid,'child');break;case 'relation-edit':relationEditor(pid,'main',id);break;case 'reference':referenceEditor([pid]);break;case 'placement':placementEditor(id);break;}});
$('closePreview').addEventListener('click',()=>$('previewDialog').close());$('previewDialog').addEventListener('close',()=>$('previewFrame').removeAttribute('src'));
$('saveStatus').addEventListener('click',()=>{if(dirty)save();else toast('内容与布局保存在当前浏览器。可在设置中导出备份。');});
$('exportData').addEventListener('click',()=>{try{if(!flushRichEditors($('detailBody')))return;if(!flushInline())return;if(reconcileDelivery(state))save(false);storage.download(documentData());toast(dirty?'已导出备份，包含当前未保存修改':'备份已导出');}catch(e){toast('导出失败：'+e.message);}});
$('undo').addEventListener('click',undoWithDeliveryHistory);
world.addEventListener('click',e=>{if(e.target.closest('input,select,textarea,label'))return;if(clickSuppressed)return;const children=e.target.closest('[data-open-children]');if(children){showChildren(children.dataset.openChildren,children.closest('[data-instance]')?.dataset.instance);return;}const copy=e.target.closest('[data-copy-instance]');if(copy){duplicateInstances([copy.dataset.copyInstance]);return;}const open=e.target.closest('[data-open]');if(open){openDetail(open.dataset.open,open.closest('[data-instance]')?.dataset.instance);return;}const add=e.target.closest('[data-add-frame]');if(add){referenceEditor([],add.dataset.addFrame);return;}const remove=e.target.closest('[data-remove-frame]');if(remove){removeFrame(remove.dataset.removeFrame);return;}const rename=e.target.closest('[data-rename-frame]');if(rename){requestFrame(null,null,rename.dataset.renameFrame);return;}const c=e.target.closest('[data-instance]');if(c&&!e.shiftKey&&!space&&state.tool==='select')openDetail(c.dataset.pid,c.dataset.instance);});
world.addEventListener('pointerover',e=>{const card=e.target.closest('[data-instance]');if(card&&hoveredProject!==card.dataset.pid){hoveredProject=card.dataset.pid;renderReferenceLines();}});
world.addEventListener('pointerout',e=>{const card=e.target.closest('[data-instance]');if(card&&!card.contains(e.relatedTarget)){hoveredProject=null;renderReferenceLines();}});
world.addEventListener('keydown',e=>{
  const head=e.target.closest('[data-frame-head]');if(head&&e.target===head&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();if(canvasEditor?.clear()===false)return;selectFrame(head.dataset.frameHead,e.shiftKey);return;}
  const handle=e.target.closest('[data-resize-frame]');if(!handle)return;
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||state.tool!=='select')return;e.stopPropagation();e.preventDefault();if(gesture||!flushInline()||canvasEditor?.clear()===false)return;
  const id=handle.dataset.resizeFrame,edge=handle.dataset.resizeEdge,frame=state.frames.find(f=>f.id===id);if(!frame)return;
  selectFrame(id);const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
  mutate(()=>{Object.assign(frame,resizeFrameBounds(frame,edge,dx,dy));reconcileMembership(state.instances.map(i=>i.id),[frame]);},'',{keepDetail:true});
  world.querySelector('[data-resize-frame="'+id+'"][data-resize-edge="'+edge+'"]')?.focus({preventScroll:true});
});
world.addEventListener('dblclick',e=>{const h=e.target.closest('[data-frame-head]');if(h&&!e.target.closest('button'))requestFrame(null,null,h.dataset.frameHead);});
    function selectedMember(id){return state.frames.some(f=>state.selectedFrames.has(f.id)&&f.members.includes(id));}
    function selectFrame(id,additive=false){
      if(!additive){state.selected.clear();state.selectedFrames.clear();}
      if(additive&&state.selectedFrames.has(id))state.selectedFrames.delete(id);else state.selectedFrames.add(id);
      renderSelection();
    }
    viewport.addEventListener('pointerdown',e=>{
      if(gesture||e.button!==0&&e.button!==1)return;
      if(e.target.closest('button,a,input,select,textarea,label')&&!e.target.closest('[data-resize-frame]'))return;
      const p=toWorld(e.clientX,e.clientY),card=e.target.closest('[data-instance]'),head=e.target.closest('[data-frame-head]'),handle=e.target.closest('[data-resize-frame]');
      if(space||state.tool==='pan'||e.button===1){gesture={type:'pan',startX:e.clientX,startY:e.clientY,view:{...state.view},moved:false,blank:!card&&!head&&!handle,collapseOnClick:e.button===0&&!space};}
      else if(handle&&state.tool==='select'){
        if(!flushInline()||canvasEditor?.clear()===false)return;
        const f=state.frames.find(f=>f.id===handle.dataset.resizeFrame);if(!f)return;
        selectFrame(f.id);handle.focus({preventScroll:true});gesture={type:'resize',start:p,frame:clone(f),edge:handle.dataset.resizeEdge,moved:false};
        world.querySelector('[data-frame="'+f.id+'"]')?.classList.add('resizing');viewport.classList.add('frame-resizing');viewport.style.cursor=getComputedStyle(handle).cursor;
      }else if(card&&state.tool==='select'){
        if(!flushInline())return;const id=card.dataset.instance;
        if(e.shiftKey){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);renderSelection();gesture={type:'toggle',moved:false};}
        else{if(!state.selected.has(id)&&!selectedMember(id)){state.selected.clear();state.selectedFrames.clear();state.selected.add(id);}renderSelection();gesture={type:'card',pid:card.dataset.pid,instanceId:id,start:p,...moveSelection(state,{instanceId:id}),moved:false};}
      }else if(head&&state.tool==='select'){
        if(!flushInline())return;const id=head.dataset.frameHead;
        if(e.shiftKey){selectFrame(id,true);gesture={type:'toggle',moved:false};}
        else{if(!state.selectedFrames.has(id))selectFrame(id);gesture={type:'frame',frameId:id,start:p,...moveSelection(state,{frameId:id}),moved:false};head.focus({preventScroll:true});}
      }else{
        if(!e.shiftKey){state.selected.clear();state.selectedFrames.clear();renderSelection();}
        const rect=document.createElement('div');rect.className='marquee';rect.id='marquee';world.append(rect);
        gesture={type:state.tool==='frame'?'draw':'select',start:p,shift:e.shiftKey,initial:[...state.selected],initialFrames:[...state.selectedFrames],moved:false};
        Object.assign(rect.style,{left:p.x+'px',top:p.y+'px',width:'0px',height:'0px'});
      }
      Object.assign(gesture,{pointerId:e.pointerId,lastX:e.clientX,lastY:e.clientY,initialView:{...state.view},viewChanged:false});
      viewport.setPointerCapture(e.pointerId);e.preventDefault();
    });
    function updateGesture(clientX,clientY){
      if(!gesture)return;const g=gesture;g.lastX=clientX;g.lastY=clientY;
      const p=toWorld(clientX,clientY);
      if(g.type==='pan'){const dx=clientX-g.startX,dy=clientY-g.startY;state.view.x=g.view.x+dx;state.view.y=g.view.y+dy;g.moved||=Math.abs(dx)+Math.abs(dy)>3;applyView();return;}
      if(g.type==='toggle')return;
      const dx=p.x-g.start.x,dy=p.y-g.start.y;
      if(Math.abs(dx)+Math.abs(dy)>4/state.view.z)g.moved=true;
      if(g.type==='resize'){
        if(!g.moved)return;const f=state.frames.find(f=>f.id===g.frame.id);Object.assign(f,resizeFrameBounds(g.frame,g.edge,dx,dy));
        Object.assign(world.querySelector('[data-frame="'+f.id+'"]').style,{left:f.x+'px',top:f.y+'px',width:f.w+'px',height:f.h+'px'});return;
      }
      if(g.type==='card'||g.type==='frame'){
        if(!g.moved)return;
        for(const old of g.items){const i=state.instances.find(i=>i.id===old.id);if(!i)continue;i.x=old.x+dx;i.y=old.y+dy;const el=world.querySelector('[data-instance="'+i.id+'"]');if(el){el.style.left=i.x+'px';el.style.top=i.y+'px';el.classList.add('dragging');}}
        for(const old of g.frames){const f=state.frames.find(f=>f.id===old.id);if(!f)continue;f.x=old.x+dx;f.y=old.y+dy;const el=world.querySelector('[data-frame="'+f.id+'"]');Object.assign(el.style,{left:f.x+'px',top:f.y+'px'});}
        for(const old of g.canvasItems){const item=state.canvasItems.find(i=>i.id===old.id);if(item){Object.assign(item,old);translateCanvasItem(item,dx,dy);canvasEditor?.refresh(item.id);}}
        renderReferenceLines();return;
      }
      g.bounds={x:Math.min(p.x,g.start.x),y:Math.min(p.y,g.start.y),w:Math.abs(dx),h:Math.abs(dy)};
      Object.assign($('marquee').style,{left:g.bounds.x+'px',top:g.bounds.y+'px',width:g.bounds.w+'px',height:g.bounds.h+'px'});
      if(g.type==='select'){
        state.selected=new Set(g.initial);state.selectedFrames=new Set([...g.initialFrames,...enclosedFrameIds(state.frames,g.bounds)]);
        state.instances.forEach(i=>{if(!isClosedProject(byId[i.pid])&&intersects(boxFor(i),g.bounds))state.selected.add(i.id);});renderSelection();
      }
    }
    viewport.addEventListener('pointermove',e=>{if(gesture?.pointerId===e.pointerId)updateGesture(e.clientX,e.clientY);});
    function cancelGesture(e){
      if(!gesture)return;const g=gesture;gesture=null;viewport.classList.remove('frame-resizing');viewport.style.removeProperty('cursor');
      for(const old of [...(g.frames||[]),...(g.frame?[g.frame]:[])]){const f=state.frames.find(f=>f.id===old.id);if(f)Object.assign(f,old);}
      for(const old of g.items||[]){const i=state.instances.find(i=>i.id===old.id);if(i)Object.assign(i,old);}
      for(const old of g.canvasItems||[]){const i=state.canvasItems.find(i=>i.id===old.id);if(i)Object.assign(i,old);}
      if(g.type==='pan'||g.viewChanged)state.view=g.initialView;
      if(g.type==='select'){state.selected=new Set(g.initial);state.selectedFrames=new Set(g.initialFrames);}
      $('marquee')?.remove();if(viewport.hasPointerCapture(g.pointerId))viewport.releasePointerCapture(g.pointerId);renderWorld();
    }
    function endGesture(e){
      if(!gesture||gesture.pointerId!==e.pointerId)return;if(e.type==='pointercancel'){cancelGesture(e);return;}
      const g=gesture;gesture=null;viewport.classList.remove('frame-resizing');viewport.style.removeProperty('cursor');$('marquee')?.remove();
      if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
      if(g.moved||g.type==='card'){clickSuppressed=true;setTimeout(()=>clickSuppressed=false,50);}
      if((g.type==='card'||g.type==='frame')&&g.moved){const grouped=new Set(g.frames.flatMap(f=>f.members));reconcileMembership(g.items.filter(i=>!grouped.has(i.id)).map(i=>i.id));}
      if(g.type==='card'&&!g.moved&&e.type==='pointerup')openDetail(g.pid,g.instanceId);
      if(g.type==='frame'&&!g.moved&&e.type==='pointerup'){const now=Date.now();if(lastFrameClick?.id===g.frameId&&now-lastFrameClick.time<350){requestFrame(null,null,g.frameId);lastFrameClick=null;}else lastFrameClick={id:g.frameId,time:now};}
      if(!g.moved&&state.detail&&((g.type==='select'&&!g.shift)||(g.type==='pan'&&g.blank&&g.collapseOnClick)))closeDetail();
      if(g.type==='draw'&&g.bounds&&g.bounds.w>40&&g.bounds.h>40){const ids=state.instances.filter(i=>!isClosedProject(byId[i.pid])&&intersects(boxFor(i),g.bounds)).map(i=>i.id);requestFrame(g.bounds,ids);}
      if(g.type==='resize'&&g.moved)reconcileMembership(state.instances.map(i=>i.id),state.frames.filter(f=>f.id===g.frame.id));
      const changed=['frame','card','resize'].includes(g.type)&&g.moved;
      if(changed)renderWorld();world.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
      if(changed)save();else if(g.viewChanged||(g.type==='pan'&&g.moved))save(false);
    }
    viewport.addEventListener('pointerup',endGesture);viewport.addEventListener('pointercancel',endGesture);viewport.addEventListener('lostpointercapture',e=>{if(gesture?.pointerId===e.pointerId)cancelGesture(e);});
    viewport.addEventListener('scroll',()=>{if(viewport.scrollTop||viewport.scrollLeft)applyView();});
    viewport.addEventListener('wheel',e=>{
      e.preventDefault();const r=viewport.getBoundingClientRect(),delta=wheelDelta(e,{width:r.width,height:r.height}),g=gesture;
      if(!delta.x&&!delta.y)return;
      if(e.ctrlKey||e.metaKey){
        if(g?.type==='pan')return;
        zoom(Math.exp(-delta.y*.007),e.clientX-r.left,e.clientY-r.top,!g);
      }else{state.view.x-=delta.x;state.view.y-=delta.y;if(g?.type==='pan'){g.view.x-=delta.x;g.view.y-=delta.y;}applyView();}
      if(g){g.viewChanged=true;g.moved=true;updateGesture(g.lastX,g.lastY);}else if(!e.ctrlKey&&!e.metaKey)save(false);
    },{passive:false});
    document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,[contenteditable="true"],[data-color-menu],[data-color-trigger],[data-tag]')||document.querySelector('dialog[open]'))return;if(gesture&&e.key!=='Escape'){e.preventDefault();return;}if(e.code==='Space'){e.preventDefault();space=true;viewport.classList.add('panning')}if(e.key==='Escape'){if(gesture){cancelGesture(e);return;}closeOrCancel();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'&&state.display==='canvas'&&state.mode!=='gather'){if(state.selectedFrames.size){e.preventDefault();return;}const card=e.target.closest('[data-instance]');const ids=card&&!state.selected.has(card.dataset.instance)?[card.dataset.instance]:[...state.selected];if(ids.length){e.preventDefault();duplicateInstances(ids);}return;}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();return}if(e.metaKey||e.ctrlKey||e.altKey)return;const key=e.key.toLowerCase();if(key==='v')setTool('select');if(key==='h')setTool('pan');if(key==='f')setTool('frame');if(key==='g'&&state.selected.size)groupSelection();if(key==='+'||key==='=')zoom(1.15);if(key==='-')zoom(1/1.15)});document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;setTool(state.tool)}});window.addEventListener('blur',()=>{space=false;cancelGesture();$('marquee')?.remove();world.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));setTool(state.tool)});
    let resized;window.addEventListener('resize',()=>{clearTimeout(resized);resized=setTimeout(()=>{if(!window.matchMedia('(max-width:760px)').matches){document.body.classList.remove('sidebar-open');$('sidebarBackdrop').hidden=true}applyView();applyFilter();if(state.detail)resizeInlineFields()},100)});

}
async function boot(){
 try {
  const response=await fetch('./initial-data.json');
  if(!response.ok)throw Error('初始项目尚未就绪');
  const seed=await response.json(),loaded=storage.load(seed);
  if(loaded.error){$('loadCaption').textContent='本地记录读取失败，原记录已保留';$('saveStatus').textContent='需要恢复';$('world').innerHTML='<div class="load-error"><h2>本地记录暂时无法读取</h2><p>'+esc(loaded.error)+'</p><p>原记录已保留。先导出原始备份，再处理恢复。</p><button id="downloadRaw">导出原始记录</button></div>';$('downloadRaw').onclick=()=>storage.download(localStorage.getItem(storageKey('topic-workbench-v2')));return;}
  if(!loaded.data.domainTagVersion&&loaded.fromStorage)localStorage.setItem(storageKey('topic-workbench-v2-before-domain-tags'),JSON.stringify(loaded.data));
  if(!loaded.data.projectContentVersion&&loaded.fromStorage)localStorage.setItem(storageKey('topic-workbench-v2-before-project-content'),JSON.stringify(loaded.data));
  const enriched=detachSourceMetadata(enrichProjectContent(applyDomainTags(enrichWorkbench(loaded.data)))).data;
  if(!loaded.data.workbenchVersion&&loaded.fromStorage)localStorage.setItem(storageKey('topic-workbench-v2-before-workbench-upgrade'),JSON.stringify(loaded.data));
  const {tags,...data}=enriched;
  state={...data,canvasItems:data.canvasItems||[],tagDefinitions:tags,selected:new Set(),selectedFrames:new Set(),tags:new Set(),logic:'intersection',mode:'highlight',query:'',tool:'select',detail:null,detailInstance:null,display:'canvas',activeBoard:null,scopeFrame:null,deliveryFilter:'active',deliveryQuery:''};
  reconcileDelivery(state);
  deliveryController=createDeliveryController({getState:()=>state,mutate,flush:flushInline,editor,field,area,check,openProject:openDetail,navigate,toast,storageKey});
  indexData();canvasEditor=createCanvasEditor({world,viewport,getState:()=>state,mutate,save,toWorld,setTool,isPanning:e=>space||state.tool==='pan'||e.button===1,clearProjects:()=>{state.selected.clear();state.selectedFrames.clear();renderSelection();},closeDetail,toast,onEditing:()=>{dirty=true;$('saveStatus').textContent='正在编辑…';}});workbench=createWorkbenchViews({getState:()=>state,update:mutate,openProject:openDetail,cardElement,navigate,editor,field,area,matches,afterRender:syncActiveProject});bindEvents();
  const compact=matchMedia('(min-width:761px) and (max-width:1100px)').matches;if(compact)document.body.classList.add('sidebar-collapsed');
  renderAll();setDisplay(state.display);save(false);
  try { snapshots.list(); } catch(error) { toast(error.message); }
  const linkedProject=new URLSearchParams(location.search).get('project');if(linkedProject&&byId[linkedProject])openDetail(linkedProject);
  $('toggleSidebar').setAttribute('aria-expanded',String(!mobile()&&!compact));
 }catch(error){$('loadCaption').textContent='载入失败：'+error.message;$('saveStatus').textContent='未载入';world.innerHTML='<div class="load-error"><h2>项目暂时无法载入</h2><p>'+esc(error.message)+'</p><button onclick="location.reload()">重新载入</button></div>';}
}
boot();
