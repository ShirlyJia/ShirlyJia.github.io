const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const orderedTags=tags=>[...tags].sort((a,b)=>(a.rank||0)-(b.rank||0));

export function renameTag(tags,id,value){
  const name=String(value??'').trim();
  if(!name)throw Error('标签名称不能为空');
  if(name.length>40)throw Error('标签名称最多 40 个字符');
  if(!tags.some(t=>t.id===id))throw Error('标签已不存在');
  if(tags.some(t=>t.id!==id&&t.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('已有同名标签，请换一个名称');
  return tags.map(t=>t.id===id?{...t,name}:t);
}

/** Stable identity: changing display order never rewrites project tag references. */
export function moveTag(tags,id,targetId,side='before'){
  const sorted=orderedTags(tags);
  if(id===targetId||!sorted.some(t=>t.id===id)||!sorted.some(t=>t.id===targetId))return sorted;
  const moving=sorted.find(t=>t.id===id),rest=sorted.filter(t=>t.id!==id);
  const at=rest.findIndex(t=>t.id===targetId)+(side==='after'?1:0);rest.splice(at,0,moving);
  return rest.map((t,rank)=>({...t,rank}));
}

export function tagFilterMarkup(tags,selected,colorControl){
  return orderedTags(tags).map(t=>'<span class="filter-token" data-tag-token="'+esc(t.id)+'"><button class="filter-tag'+(selected.has(t.id)?' active':'')+'" data-tag="'+esc(t.id)+'" aria-pressed="'+selected.has(t.id)+'" aria-keyshortcuts="F2 Alt+ArrowLeft Alt+ArrowRight" title="单击筛选 · 双击改名 · 拖动排序"><span class="tag-dot" style="background:'+esc(t.color)+'"></span><span>'+esc(t.name)+'</span></button>'+colorControl(t.color,'data-tag-color',t.id,'调整'+t.name+'颜色')+'</span>').join('');
}

/** Editing and sorting reuse the labels and rows already on screen; no new buttons. */
export function mountTagEditor({bar,rows,getTags,saveName,reorder,toggle,renderBar,renderRows,notify=()=>{}}){
  let editing=null,committing=false,drag=null,suppressUntil=0;
  const composing=new WeakSet();
  const tag=id=>getTags().find(t=>t.id===id);
  const button=id=>[...bar.querySelectorAll('[data-tag]')].find(el=>el.dataset.tag===id);
  function capture(){
    if(!editing?.input?.isConnected)return null;
    const input=editing.input;return{id:editing.id,value:input.value,start:input.selectionStart,end:input.selectionEnd,focus:document.activeElement===input,invalid:input.getAttribute('aria-invalid')==='true',pending:input.dataset.tagPending==='true'};
  }
  function restore(draft){
    if(!draft||!tag(draft.id))return;
    const target=button(draft.id);if(!target)return;
    const input=document.createElement('input');input.className='tag-name-editor';input.dataset.tagName=draft.id;input.maxLength=40;input.value=draft.value;
    input.setAttribute('aria-label','标签名称：'+tag(draft.id).name);input.setAttribute('title','Enter 保存 · Esc 取消');
    input.style.width=Math.max(90,Math.min(330,target.getBoundingClientRect().width))+'px';
    if(draft.invalid)input.setAttribute('aria-invalid','true');if(draft.pending)input.dataset.tagPending='true';
    target.replaceWith(input);editing={id:draft.id,input};
    if(draft.focus){input.focus({preventScroll:true});input.setSelectionRange(draft.start??0,draft.end??input.value.length);}
  }
  function begin(id){
    if(!flush())return;const item=tag(id);if(item)restore({id,value:item.name,focus:true});
  }
  function commit(input){
    if(committing)return true;
    const id=input?.dataset.tagName,current=tag(id);if(!current)return true;
    const isBar=bar.contains(input);
    if(!input.dataset.tagPending){if(isBar){editing=null;renderBar();}else{input.value=current.name;input.setAttribute('aria-label','标签名称：'+current.name);}return true;}
    if(composing.has(input))return false;
    const draft={id,value:input.value,start:input.selectionStart,end:input.selectionEnd,focus:document.activeElement===input,pending:true};
    try{renameTag(getTags(),id,input.value);}catch(error){input.setAttribute('aria-invalid','true');notify(error.message);return false;}
    if(isBar)editing=null;
    if(input.value.trim()===current.name){delete input.dataset.tagPending;input.removeAttribute('aria-invalid');if(isBar)renderBar();return true;}
    committing=true;let ok=false;
    try{ok=saveName(id,input.value)!==false;}catch(error){notify(error.message);}finally{committing=false;}
    if(!ok){if(isBar){restore({...draft,invalid:true});}else input.setAttribute('aria-invalid','true');return false;}
    delete input.dataset.tagPending;
    if(!isBar){input.value=tag(id).name;input.removeAttribute('aria-invalid');input.setAttribute('aria-label','标签名称：'+tag(id).name);}
    return true;
  }
  function flush(){
    if(committing)return true;
    let ok=true;
    for(const input of [...bar.querySelectorAll('[data-tag-name]'),...rows.querySelectorAll('[data-tag-name]')])if(!commit(input))ok=false;
    return ok;
  }
  function cancel(input){
    const current=tag(input.dataset.tagName);if(!current)return;
    if(bar.contains(input)){const id=current.id;editing=null;renderBar();button(id)?.focus({preventScroll:true});}
    else {delete input.dataset.tagPending;input.value=current.name;input.removeAttribute('aria-invalid');input.blur();}
  }
  function move(id,target,side){
    if(!flush())return false;
    const old=orderedTags(getTags()).map(t=>t.id),next=moveTag(getTags(),id,target,side);
    if(next.every((t,i)=>t.id===old[i]))return true;
    const ok=reorder(id,target,side)!==false;
    if(ok)renderRows();return ok;
  }
  bar.addEventListener('click',event=>{
    const target=event.target.closest('[data-tag]');if(!target)return;
    if(Date.now()<suppressUntil){event.preventDefault();return;}
    if(flush())toggle(target.dataset.tag);
  });
  bar.addEventListener('dblclick',event=>{const target=event.target.closest('[data-tag]');if(target){event.preventDefault();begin(target.dataset.tag);}});
  for(const host of [bar,rows]){
    host.addEventListener('compositionstart',e=>{if(e.target.matches('[data-tag-name]'))composing.add(e.target);});
    host.addEventListener('compositionend',e=>{composing.delete(e.target);});
    host.addEventListener('input',e=>{if(e.target.matches('[data-tag-name]')){e.target.dataset.tagPending='true';e.target.removeAttribute('aria-invalid');}});
    host.addEventListener('focusout',e=>{if(e.target.matches('[data-tag-name]'))commit(e.target);});
    host.addEventListener('keydown',event=>{
      const input=event.target.closest('[data-tag-name]'),id=input?.dataset.tagName||event.target.closest('[data-tag]')?.dataset.tag||event.target.closest('[data-tag-row]')?.dataset.tagRow;
      if(!id)return;event.stopPropagation();if(event.isComposing||composing.has(event.target))return;
      if(event.key==='Escape'&&input){event.preventDefault();cancel(input);return;}
      if(event.key==='Enter'&&input){event.preventDefault();if(commit(input)){if(host===bar)button(id)?.focus({preventScroll:true});else input.blur();}return;}
      if(event.key==='F2'&&host===bar){event.preventDefault();begin(id);return;}
      if(event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();const tags=orderedTags(getTags()),index=tags.findIndex(t=>t.id===id),forward=['ArrowRight','ArrowDown'].includes(event.key),target=tags[index+(forward?1:-1)];
        if(target&&move(id,target.id,forward?'after':'before'))(host===bar?button(id):[...rows.querySelectorAll('[data-tag-row]')].find(el=>el.dataset.tagRow===id))?.focus({preventScroll:true});
      }
    });
    host.addEventListener('pointerdown',event=>{
      if(event.button!==0||drag||event.target.closest('input,[data-color-control],[data-delete-tag]'))return;
      const item=event.target.closest(host===bar?'[data-tag]':'[data-tag-row]');if(!item||!flush())return;
      drag={id:item.dataset.tag||item.dataset.tagRow,host,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,ghost:null};
    });
  }
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
    event.preventDefault();
    if(!drag.moved){
      drag.moved=true;drag.host.setPointerCapture(event.pointerId);drag.host.classList.add('tag-sorting');
      const el=drag.host===bar?button(drag.id)?.closest('[data-tag-token]'):[...rows.querySelectorAll('[data-tag-row]')].find(el=>el.dataset.tagRow===drag.id);el?.classList.add('tag-dragging');
      const ghost=document.createElement('div');ghost.className='tag-drag-preview';ghost.textContent=tag(drag.id)?.name||'';ghost.setAttribute('aria-hidden','true');
      (drag.host.closest('dialog[open]')||document.body).append(ghost);drag.ghost=ghost;
    }
    drag.ghost.style.left=(event.clientX+12)+'px';drag.ghost.style.top=(event.clientY+12)+'px';
    clearMarkers();const target=dropTarget(event,drag.host);if(target&&target.id!==drag.id)target.el.classList.add('tag-drop-'+target.side);
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    const current=drag,target=current.moved?dropTarget(event,current.host):null;endDrag();
    if(current.moved&&target)move(current.id,target.id,target.side);
  });
  document.addEventListener('pointercancel',event=>{if(drag?.pointerId===event.pointerId)endDrag();});
  document.addEventListener('keydown',event=>{if(drag?.moved&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();endDrag();}},true);
  window.addEventListener('blur',()=>{if(drag)endDrag();});
  function clearMarkers(){for(const host of [bar,rows])host.querySelectorAll('.tag-drop-before,.tag-drop-after').forEach(el=>el.classList.remove('tag-drop-before','tag-drop-after'));}
  function endDrag(){
    if(!drag)return;const current=drag;drag=null;if(current.moved)suppressUntil=Date.now()+300;
    current.ghost?.remove();current.host.classList.remove('tag-sorting');clearMarkers();
    for(const host of [bar,rows])host.querySelectorAll('.tag-dragging').forEach(el=>el.classList.remove('tag-dragging'));
    if(current.host.hasPointerCapture(current.pointerId))current.host.releasePointerCapture(current.pointerId);
  }
  function dropTarget(event,host){
    const box=host.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)return null;
    const elements=[...host.querySelectorAll(host===bar?'[data-tag-token]':'[data-tag-row]')];
    let nearest=null,distance=Infinity;
    for(const el of elements){const r=el.getBoundingClientRect(),dx=Math.max(r.left-event.clientX,0,event.clientX-r.right),dy=Math.max(r.top-event.clientY,0,event.clientY-r.bottom),d=dx*dx+dy*dy;if(d<distance){distance=d;nearest={el,id:el.dataset.tagToken||el.dataset.tagRow,side:(host===bar?event.clientX<r.left+r.width/2:event.clientY<r.top+r.height/2)?'before':'after'};}}
    return nearest;
  }
  rows.addEventListener('submit',event=>{event.preventDefault();const input=event.target.querySelector('[data-tag-name]');if(input)commit(input);});
  return {capture,restore,flush,cancel(){if(editing)cancel(editing.input);},isEditing:()=>!!editing};
}
