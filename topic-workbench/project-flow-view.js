import {readProjectFlow, renameFlowNode, insertFlowNode, removeFlowNode, moveFlowNode, setCurrentFlowNode, setFlowNodeClosing} from './project-flow.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titleWidth = value => Math.max(28, Math.min(190, [...String(value)].reduce((sum,c)=>sum+(/[\u0000-\u00ff]/.test(c)?7:13),0)+4));

function contents(project) {
  const flow=readProjectFlow(project), current=flow.nodes.findIndex(node=>node.id===flow.currentId);
  if(!flow.nodes.length)return '<button type="button" class="flow-empty-add" data-flow-add="">＋ 添加流程节点</button><p class="flow-save-error" role="status" hidden></p>';
  return '<div class="flow-rail" role="list" aria-label="项目流程节点">'+flow.nodes.map((node,index)=>{
    const active=node.id===flow.currentId, passed=current>=0&&index<current;
    const name=esc(node.title), id=esc(node.id);
    return '<div class="flow-node'+(active?' current':'')+(passed?' passed':'')+'" role="listitem" data-flow-node="'+id+'">'+
      '<div class="flow-pill"><button type="button" class="flow-dot-button" data-flow-current="'+id+'" aria-label="设为当前节点：'+name+'" aria-pressed="'+active+'" title="'+(node.closesProject?'切换到这里并结束项目':'切换到这里继续跟进')+'"><span class="flow-dot" aria-hidden="true"></span></button>'+ 
      '<input class="flow-title" data-flow-title="'+id+'" aria-label="节点名称：'+name+'" title="直接修改名称；Enter 新增下一个节点" value="'+name+'" maxlength="120" style="width:'+titleWidth(node.title)+'px">'+
      '<button type="button" class="flow-drag-handle" data-flow-drag="'+id+'" draggable="true" aria-label="拖动排序：'+name+'" title="拖动排序；也可按 Alt + 左右方向键">⠿</button></div>'+ 
      '<div class="flow-node-tools"><button type="button" data-flow-add="'+id+'" aria-label="在'+name+'后新增节点" title="新增后续节点（Enter）">＋</button>'+ 
      '<button type="button" data-flow-move="'+id+'" data-step="-1" aria-label="前移节点：'+name+'" title="前移"'+(index===0?' disabled':'')+'>‹</button>'+ 
      '<button type="button" data-flow-move="'+id+'" data-step="1" aria-label="后移节点：'+name+'" title="后移"'+(index===flow.nodes.length-1?' disabled':'')+'>›</button>'+ 
      '<button type="button" class="flow-options-toggle" data-flow-options="'+id+'" aria-label="节点选项：'+name+'" title="节点选项" aria-expanded="false">···</button></div>'+ 
      '</div>';
  }).join('')+'</div><div class="flow-options" hidden></div><p class="flow-save-error" role="status" hidden></p>';
}

export function flowMarkup(project) {
  return '<section class="project-flow" data-project-flow="'+esc(project.id)+'" aria-label="项目流程">'+contents(project)+'</section>';
}

/** Owns only the embedded strip. Project facts and persistence remain with the app. */
export function mountProjectFlow(root,{getProject,mutate,toast=()=>{},onChange=()=>{}}={}) {
  const host=root?.matches?.('[data-project-flow]')?root:root?.querySelector('[data-project-flow]');
  if(!host)return {flush:()=>true,destroy:()=>{}};
  const owner=host.dataset.projectFlow, controller=new AbortController();
  let committing=false, destroyed=false, dragging=null;
  const project=()=>{const value=getProject();return value?.id===owner?value:null;};
  const listen=(name,fn)=>host.addEventListener(name,fn,{signal:controller.signal});
  const error=message=>{const target=host.querySelector('.flow-save-error');if(target){target.textContent=message;target.hidden=!message;}if(message)toast(message);};
  function refresh(focusId=null,select=false) {
    const value=project();if(!value||destroyed||!host.isConnected)return;
    const rail=host.querySelector('.flow-rail'),scroll=rail?.scrollLeft||0;
    host.innerHTML=contents(value);
    const nextRail=host.querySelector('.flow-rail');if(nextRail)nextRail.scrollLeft=scroll;
    const input=[...host.querySelectorAll('[data-flow-title]')].find(el=>el.dataset.flowTitle===focusId);
    if(input){input.focus({preventScroll:true});if(select)input.select();input.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
  function commit(input) {
    if(!input?.dataset.flowPending)return true;
    if(input.dataset.flowComposing==='true'){error('请完成输入后再切换。');return false;}
    const value=project();if(!value)return false;
    const next=input.value.trim();
    if(!next){input.setAttribute('aria-invalid','true');error('请填写节点名称，或从节点选项中删除。');return false;}
    let ok=false;committing=true;
    try {ok=mutate(()=>renameFlowNode(project(),input.dataset.flowTitle,next),'',{keepDetail:true})!==false;}
    catch(failure){error(failure.message||'节点名称未保存');}
    finally{committing=false;}
    if(!ok){error('节点修改尚未保存，请重试。');return false;}
    delete input.dataset.flowPending;input.removeAttribute('aria-invalid');input.value=next;input.style.width=titleWidth(next)+'px';error('');
    // Do not replace the focused input on blur: a following toolbar click must retain its target.
    input.setAttribute('aria-label','节点名称：'+next);
    const node=input.closest('[data-flow-node]');
    node?.querySelector('[data-flow-current]')?.setAttribute('aria-label','设为当前节点：'+next);
    node?.querySelector('[data-flow-drag]')?.setAttribute('aria-label','拖动排序：'+next);
    node?.querySelector('[data-flow-add]')?.setAttribute('aria-label','在'+next+'后新增节点');
    node?.querySelector('[data-step="-1"]')?.setAttribute('aria-label','前移节点：'+next);
    node?.querySelector('[data-step="1"]')?.setAttribute('aria-label','后移节点：'+next);
    node?.querySelector('[data-flow-options]')?.setAttribute('aria-label','节点选项：'+next);
    onChange({kind:'rename',project:project(),nodeId:input.dataset.flowTitle});
    return true;
  }
  function flush(exceptId=null) {
    if(committing||destroyed)return true;
    let ok=true;for(const input of host.querySelectorAll('[data-flow-pending]'))if(input.dataset.flowTitle!==exceptId&&!commit(input))ok=false;
    return ok;
  }
  function change(kind,nodeId,operation,{focus=null,select=false,skipPendingId=null}={}) {
    if(!flush(skipPendingId)||!project())return false;
    let ok=false,result;committing=true;
    try {ok=mutate(()=>{result=operation(project());},'',{keepDetail:true})!==false;}
    catch(failure){error(failure.message||'流程修改未保存');}
    finally{committing=false;}
    if(!ok){error('流程修改尚未保存，请重试。');return false;}
    refresh(typeof focus==='function'?focus(result):focus,select);
    onChange({kind,project:project(),nodeId:result?.id||nodeId});return true;
  }
  function add(after) {
    return change('add',after,p=>insertFlowNode(p,after||null),{focus:result=>result.id,select:true});
  }
  function move(id,step) {
    const flow=readProjectFlow(project()),index=flow.nodes.findIndex(node=>node.id===id),next=index+step;
    if(index<0||next<0||next>=flow.nodes.length)return false;
    return change('move',id,p=>moveFlowNode(p,id,next),{focus:id});
  }
  function options(id) {
    const value=project(),node=readProjectFlow(value).nodes.find(item=>item.id===id);if(!node)return;
    const panel=host.querySelector('.flow-options'),wasOpen=panel.dataset.node===id&&!panel.hidden;
    host.querySelectorAll('[data-flow-options]').forEach(button=>button.setAttribute('aria-expanded',String(!wasOpen&&button.dataset.flowOptions===id)));
    if(wasOpen){panel.hidden=true;return;}
    panel.dataset.node=id;panel.hidden=false;
    panel.innerHTML='<span>'+esc(node.title)+'</span><label title="设为结束节点后，点击它的圆点会结束项目"><input type="checkbox" data-flow-closing="'+esc(id)+'"'+(node.closesProject?' checked':'')+'>结束节点</label><button type="button" data-flow-remove="'+esc(id)+'">删除节点</button><button type="button" data-flow-close-options aria-label="关闭节点选项">×</button>';
  }
  listen('input',event=>{
    const input=event.target.closest('[data-flow-title]');if(!input)return;
    input.dataset.flowPending='true';input.style.width=titleWidth(input.value)+'px';input.removeAttribute('aria-invalid');
  });
  listen('compositionstart',event=>{if(event.target.matches('[data-flow-title]'))event.target.dataset.flowComposing='true';});
  listen('compositionend',event=>{delete event.target.dataset.flowComposing;});
  listen('focusout',event=>{if(event.target.matches('[data-flow-title]'))commit(event.target);});
  listen('keydown',event=>{
    event.stopPropagation();
    const input=event.target.closest('[data-flow-title]'),id=input?.dataset.flowTitle||event.target.closest('[data-flow-node]')?.dataset.flowNode;
    if(event.isComposing||input?.dataset.flowComposing==='true')return;
    if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)&&id){event.preventDefault();move(id,event.key==='ArrowLeft'?-1:1);return;}
    if(!input)return;
    if(event.key==='Escape'){
      event.preventDefault();const saved=readProjectFlow(project()).nodes.find(node=>node.id===id);if(saved)input.value=saved.title;
      delete input.dataset.flowPending;input.removeAttribute('aria-invalid');input.style.width=titleWidth(input.value)+'px';error('');input.blur();return;
    }
    if(event.key==='Enter'){event.preventDefault();if(commit(input))add(id);return;}
  });
  // Keep a pointer click from disappearing when the title's blur commit runs.
  listen('mousedown',event=>{if(event.target.closest('button[data-flow-add],button[data-flow-move],button[data-flow-options],button[data-flow-current],button[data-flow-remove]'))event.preventDefault();});
  listen('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    event.stopPropagation();
    if(button.hasAttribute('data-flow-add')){add(button.dataset.flowAdd);return;}
    if(button.hasAttribute('data-flow-current')){change('current',button.dataset.flowCurrent,p=>setCurrentFlowNode(p,button.dataset.flowCurrent));return;}
    if(button.hasAttribute('data-flow-move')){move(button.dataset.flowMove,Number(button.dataset.step));return;}
    if(button.hasAttribute('data-flow-options')){options(button.dataset.flowOptions);return;}
    if(button.hasAttribute('data-flow-remove')){change('remove',button.dataset.flowRemove,p=>removeFlowNode(p,button.dataset.flowRemove),{skipPendingId:button.dataset.flowRemove});return;}
    if(button.hasAttribute('data-flow-close-options')){host.querySelector('.flow-options').hidden=true;host.querySelectorAll('[data-flow-options]').forEach(el=>el.setAttribute('aria-expanded','false'));}
  });
  listen('change',event=>{
    const input=event.target.closest('[data-flow-closing]');if(!input)return;
    const checked=input.checked;
    if(!change('closing',input.dataset.flowClosing,p=>setFlowNodeClosing(p,input.dataset.flowClosing,checked)))input.checked=!checked;
  });
  listen('dragstart',event=>{
    const handle=event.target.closest('[data-flow-drag]');if(!handle)return;
    if(!flush()){event.preventDefault();return;}
    dragging=handle.dataset.flowDrag;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragging);handle.closest('.flow-node').classList.add('dragging');
  });
  listen('dragover',event=>{
    if(!dragging)return;const target=event.target.closest('[data-flow-node]');if(!target)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';host.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));if(target.dataset.flowNode!==dragging)target.classList.add('drop-target');
  });
  listen('drop',event=>{
    if(!dragging)return;event.preventDefault();event.stopPropagation();
    const id=dragging,target=event.target.closest('[data-flow-node]')?.dataset.flowNode;dragging=null;
    const index=readProjectFlow(project()).nodes.findIndex(node=>node.id===target);
    host.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));
    if(target&&target!==id&&index>=0)change('move',id,p=>moveFlowNode(p,id,index),{focus:id});
  });
  listen('dragend',()=>{dragging=null;host.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'));});
  return {flush,destroy(){destroyed=true;controller.abort();}};
}
