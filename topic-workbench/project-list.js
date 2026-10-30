import {projectListGroups,listPreferences,matchesListFilters,moveListId,priorityRank,UNGROUPED,NO_PRIORITY} from './project-list-model.js';
import {displayPriority} from './presentation.js';
import {isClosedProject} from './workbench-model.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gripIcon='<svg viewBox="0 0 16 20" aria-hidden="true"><circle cx="5" cy="4" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="5" cy="10" r="1"/><circle cx="11" cy="10" r="1"/><circle cx="5" cy="16" r="1"/><circle cx="11" cy="16" r="1"/></svg>';
const grip=(kind,id,name,group='')=>'<button type="button" class="list-sort-grip" data-list-grip="'+kind+'" data-list-id="'+esc(id)+'" data-list-group="'+esc(group)+'" aria-label="拖动排序：'+esc(name)+'" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="拖动调整顺序；Alt + ↑ / ↓">'+gripIcon+'</button>';

export function createProjectList({root,getData,cardElement,openProject,matches,beforeChange,onFilterChange,key,notify}){
  let prefs;try{prefs=listPreferences(JSON.parse(localStorage.getItem(key)||'{}'));}catch{prefs=listPreferences();}
  const groupsRoot=root.querySelector('#projectListGroups'),groupFilter=root.querySelector('#listGroupFilter'),priorityFilter=root.querySelector('#listPriorityFilter'),sort=root.querySelector('#listSort'),reverse=root.querySelector('#listSortDirection');
  let groups=[],drag=null,scrollFrame=0;
  function update(change,{refresh=true}={}){
    if(beforeChange?.()===false)return false;
    const next=listPreferences({...prefs,...change});
    try{localStorage.setItem(key,JSON.stringify(next));}catch{notify('列表设置未保存，请重试');return false;}
    prefs=next;if(refresh)onFilterChange();return true;
  }
  function render(){
    const data=getData();groups=projectListGroups(data,prefs);
    if(prefs.groupId&&!groups.some(g=>g.id===prefs.groupId))prefs.groupId='';
    const active=(data.projects||[]).filter(p=>!isClosedProject(p));
    const options='<option value="">全部分组</option>'+groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+' · '+g.rows.length+'</option>').join('');
    if(groupFilter.innerHTML!==options)groupFilter.innerHTML=options;groupFilter.value=prefs.groupId;
    const priorities=[...new Set(active.map(displayPriority).filter(Boolean))].sort((a,b)=>(priorityRank(a)??Infinity)-(priorityRank(b)??Infinity)||a.localeCompare(b));
    if(prefs.priority&&prefs.priority!==NO_PRIORITY&&!priorities.includes(prefs.priority))priorities.push(prefs.priority);
    const priorityOptions='<option value="">全部优先级</option>'+priorities.map(p=>'<option value="'+esc(p)+'">'+esc(p)+'</option>').join('')+'<option value="'+NO_PRIORITY+'">未设置优先级</option>';
    if(priorityFilter.innerHTML!==priorityOptions)priorityFilter.innerHTML=priorityOptions;priorityFilter.value=prefs.priority;
    sort.value=prefs.sort;reverse.hidden=!['priority','delivery','name'].includes(prefs.sort);reverse.textContent=prefs.descending?'↓':'↑';reverse.setAttribute('aria-label',prefs.descending?'降序，点击改为升序':'升序，点击改为降序');reverse.title=prefs.descending?'降序':'升序';
    const focused=document.activeElement?.closest('[data-list-grip],[data-list-collapse]');
    const focusKey=focused?{kind:focused.dataset.listGrip,id:focused.dataset.listId,group:focused.dataset.listGroup,collapse:focused.dataset.listCollapse}:null;
    groupsRoot.replaceChildren();const visibleIds=new Set();let shownGroups=0;
    for(const group of groups){
      if(prefs.groupId&&group.id!==prefs.groupId)continue;
      const rows=group.rows.filter(row=>matches(row.project));
      if(!rows.length&&group.rows.length)continue;
      if(!rows.length&&(prefs.priority||data.query||data.tags?.size||data.focusDirection))continue;
      rows.forEach(row=>visibleIds.add(row.project.id));shownGroups++;
      const section=document.createElement('section');section.className='project-list-group';section.dataset.listSection=group.id;
      section.style.setProperty('--list-group-color',/^#[0-9a-f]{6}$/i.test(group.color)?group.color:'#8c8981');
      const collapsed=prefs.collapsed.includes(group.id);
      section.innerHTML='<header class="list-group-header">'+(group.id!==UNGROUPED?grip('group',group.id,group.name):'<span class="list-grip-spacer"></span>')+'<button type="button" class="list-group-toggle" data-list-collapse="'+esc(group.id)+'" aria-expanded="'+!collapsed+'"><span class="list-group-chevron" aria-hidden="true">'+(collapsed?'▸':'▾')+'</span><span class="list-group-dot" aria-hidden="true"></span><strong>'+esc(group.name)+'</strong><span class="list-group-count">'+rows.length+'</span></button></header>';
      const content=document.createElement('div');content.className='list-group-projects';content.hidden=collapsed;
      for(const {project} of rows){
        const row=document.createElement('div');row.className='list-project-row';row.dataset.listProject=project.id;row.dataset.listGroup=group.id;row.innerHTML=grip('project',project.id,project.name,group.id);
        const card=cardElement(project);card.addEventListener('click',e=>{if(!e.target.closest('button,select,input,a'))openProject(project.id);});row.append(card);content.append(row);
      }
      if(!rows.length)content.innerHTML='<p class="list-group-empty">暂无项目</p>';
      section.append(content);groupsRoot.append(section);
    }
    root.querySelector('#listProjectCount').textContent=visibleIds.size+' 个项目 · '+shownGroups+' 个分组';
    root.querySelector('#listEmpty').hidden=shownGroups>0;
    if(focusKey){const target=focusKey.collapse?[...groupsRoot.querySelectorAll('[data-list-collapse]')].find(n=>n.dataset.listCollapse===focusKey.collapse):[...groupsRoot.querySelectorAll('[data-list-grip]')].find(n=>n.dataset.listGrip===focusKey.kind&&n.dataset.listId===focusKey.id&&n.dataset.listGroup===focusKey.group);target?.focus({preventScroll:true});}
  }
  function reorder(source,target,side){
    const all=projectListGroups(getData(),prefs),manual={sort:'manual',descending:false,groupOrder:all.filter(g=>g.id!==UNGROUPED).map(g=>g.id),projectOrder:Object.fromEntries(all.map(g=>[g.id,g.rows.map(r=>r.project.id)]))};
    if(source.kind==='group')manual.groupOrder=moveListId(manual.groupOrder,source.id,target,side);
    else if(manual.projectOrder[source.group])manual.projectOrder[source.group]=moveListId(manual.projectOrder[source.group],source.id,target,side);
    if(update(manual))root.querySelector('#listOrderStatus').textContent='顺序已保存';
  }
  const sourceFor=handle=>({kind:handle.dataset.listGrip,id:handle.dataset.listId,group:handle.dataset.listGroup});
  const rowsFor=source=>source.kind==='group'?[...groupsRoot.querySelectorAll('[data-list-section]')].filter(el=>el.dataset.listSection!==UNGROUPED):[...groupsRoot.querySelectorAll('[data-list-project]')].filter(el=>el.dataset.listGroup===source.group);
  const idFor=(row,source)=>source.kind==='group'?row.dataset.listSection:row.dataset.listProject;
  const clearDrop=()=>groupsRoot.querySelectorAll('.list-drop-before,.list-drop-after').forEach(el=>el.classList.remove('list-drop-before','list-drop-after'));
  const finishDrag=()=>{
    const current=drag;drag=null;cancelAnimationFrame(scrollFrame);scrollFrame=0;clearDrop();
    root.querySelectorAll('.list-is-dragging').forEach(el=>el.classList.remove('list-is-dragging'));current?.ghost?.remove();
    if(current&&root.hasPointerCapture?.(current.pointerId))root.releasePointerCapture(current.pointerId);
  };
  function locateDrop(){
    if(!drag?.active)return;clearDrop();drag.target=null;
    const bounds=root.getBoundingClientRect();
    drag.ghost.style.left=Math.max(bounds.left+10,Math.min(drag.x+14,bounds.right-drag.ghost.offsetWidth-10))+'px';drag.ghost.style.top=Math.max(8,Math.min(drag.y+12,innerHeight-44))+'px';
    const rows=rowsFor(drag).filter(row=>idFor(row,drag)!==drag.id);
    if(!rows.length||drag.x<bounds.left||drag.x>bounds.right)return;
    if(drag.kind==='project'){
      const group=[...groupsRoot.querySelectorAll('[data-list-section]')].find(el=>el.dataset.listSection===drag.group),box=group?.getBoundingClientRect();
      if(!box||drag.y<box.top||drag.y>box.bottom)return;
    }
    const target=rows.find(row=>drag.y<row.getBoundingClientRect().top+row.offsetHeight/2)||rows.at(-1),box=target.getBoundingClientRect(),side=drag.y<box.top+box.height/2?'before':'after';
    target.classList.add('list-drop-'+side);drag.target={id:idFor(target,drag),side};
  }
  function scrollDuringDrag(){
    if(!drag?.active)return;const bounds=root.getBoundingClientRect();
    const speed=drag.y<bounds.top+64?-Math.min(14,(bounds.top+64-drag.y)/4):drag.y>bounds.bottom-48?Math.min(14,(drag.y-bounds.bottom+48)/4):0;
    if(speed&&drag.x>=bounds.left&&drag.x<=bounds.right){root.scrollTop+=speed;locateDrop();}
    scrollFrame=requestAnimationFrame(scrollDuringDrag);
  }
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-list-grip]');if(!handle||event.button!==0||drag||beforeChange?.()===false||!handle.isConnected)return;
    event.preventDefault();event.stopPropagation();handle.focus({preventScroll:true});
    drag={...sourceFor(handle),pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY};
    root.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
    event.preventDefault();
    if(!drag.active){
      drag.active=true;const row=rowsFor(drag).find(row=>idFor(row,drag)===drag.id);row?.classList.add('list-is-dragging');
      drag.ghost=document.createElement('div');drag.ghost.className='list-drag-preview';drag.ghost.setAttribute('aria-hidden','true');drag.ghost.textContent=row?.querySelector(drag.kind==='group'?'.list-group-toggle strong':'.card-title')?.textContent||'调整顺序';document.body.append(drag.ghost);scrollFrame=requestAnimationFrame(scrollDuringDrag);
    }
    locateDrop();
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;const source=drag,target=drag.target;finishDrag();if(source.active&&target)reorder(source,target.id,target.side);
    [...root.querySelectorAll('[data-list-grip]')].find(el=>el.dataset.listGrip===source.kind&&el.dataset.listId===source.id&&el.dataset.listGroup===source.group)?.focus({preventScroll:true});
  });
  document.addEventListener('pointercancel',finishDrag);root.addEventListener('lostpointercapture',()=>{if(drag)finishDrag();});window.addEventListener('blur',finishDrag);
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();finishDrag();return;}
    const handle=event.target.closest('[data-list-grip]');if(!handle||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const source=sourceFor(handle),rows=rowsFor(source),index=rows.findIndex(row=>idFor(row,source)===source.id),target=rows[index+(event.key==='ArrowUp'?-1:1)];
    if(target)reorder(source,idFor(target,source),event.key==='ArrowUp'?'before':'after');
  });
  root.addEventListener('click',event=>{
    const collapse=event.target.closest('[data-list-collapse]');if(!collapse)return;
    const id=collapse.dataset.listCollapse;update({collapsed:prefs.collapsed.includes(id)?prefs.collapsed.filter(value=>value!==id):[...prefs.collapsed,id]});
  });
  groupFilter.addEventListener('change',()=>{if(!update({groupId:groupFilter.value}))groupFilter.value=prefs.groupId;});
  priorityFilter.addEventListener('change',()=>{if(!update({priority:priorityFilter.value}))priorityFilter.value=prefs.priority;});
  sort.addEventListener('change',()=>{if(!update({sort:sort.value,descending:false}))sort.value=prefs.sort;});
  reverse.addEventListener('click',()=>update({descending:!prefs.descending}));
  return {render,matches:project=>matchesListFilters(project,getData(),prefs),hasFilters:()=>!!(prefs.groupId||prefs.priority),clearFilters:()=>update({groupId:'',priority:''},{refresh:false}),setGroup:id=>update({groupId:id},{refresh:false})};
}
