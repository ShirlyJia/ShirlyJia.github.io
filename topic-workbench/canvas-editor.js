import {colorPickerMarkup} from './color-presets.js';
import {createCanvasItem, canvasItemBounds, translateCanvasItem} from './canvas-items.js';
import {renderCanvasItem} from './canvas-item-view.js';

const kinds=new Set(['text','note','line','arrow']);
const isLine=item=>item.type==='line'||item.type==='arrow';
const copy=value=>JSON.parse(JSON.stringify(value));
const labels={text:'文字',note:'便签',line:'线条',arrow:'箭头'};
const $=id=>document.getElementById(id);

/** Canvas-only presentation editing; projects and their relations stay independent. */
export function createCanvasEditor({world,viewport,getState,mutate,save,toWorld,setTool,isPanning,clearProjects,closeDetail,toast,onEditing}) {
  let selected=null,editing=null,pending=false,timer,drag=null,suppressClick=false,lastClick=null;
  const items=()=>getState().canvasItems||[];
  const current=()=>items().find(item=>item.id===selected);
  const element=id=>[...world.querySelectorAll('[data-canvas-item]')].find(el=>el.dataset.canvasItem===id);
  function flush(){clearTimeout(timer);if(!pending)return true;const ok=save();if(ok)pending=false;return ok;}
  function finishEditing(){if(!editing)return flush();if(!flush())return false;const id=editing.id;editing=null;refresh(id);return true;}
  function render(){
    editing=null;world.querySelectorAll('[data-canvas-item]').forEach(el=>el.remove());
    if(!items().some(item=>item.id===selected))selected=null;
    items().forEach(item=>world.append(renderCanvasItem(item,{selected:item.id===selected})));
    renderTools();
  }
  function refresh(id){
    const item=items().find(row=>row.id===id),old=element(id);if(!item){old?.remove();return;}
    const next=renderCanvasItem(item,{selected:id===selected});if(old)old.replaceWith(next);else world.append(next);
  }
  function select(id){
    if(selected!==id&&!finishEditing())return false;
    selected=id;world.querySelectorAll('[data-canvas-item]').forEach(el=>el.classList.toggle('selected',el.dataset.canvasItem===id));
    renderTools();return true;
  }
  function clear(){if(!finishEditing())return false;if(document.activeElement?.closest('[data-canvas-item]'))viewport.focus({preventScroll:true});selected=null;world.querySelectorAll('.canvas-item.selected').forEach(el=>el.classList.remove('selected'));renderTools();return true;}
  function renderTools(){
    const item=current(),bar=$('canvasItemTools'),state=getState();
    bar.hidden=!item||state.display!=='canvas'||state.mode==='gather';
    if(bar.hidden)return;
    const line=isLine(item);bar.innerHTML='';
    const name=document.createElement('span');name.className='canvas-tool-label';name.textContent=labels[item.type];bar.append(name);
    bar.insertAdjacentHTML('beforeend',colorPickerMarkup(item.color,'data-canvas-style','color',item.type==='note'?'便签颜色':'画板元素颜色',{variant:item.type==='note'?'surface':'ink'}));
    const options=line?[[1,'细'],[2,'标准'],[4,'粗'],[6,'加粗']]:[[14,'14'],[18,'18'],[24,'24'],[32,'32'],[40,'40'],[56,'56']];
    const property=line?'strokeWidth':'fontSize',value=item[property];if(!options.some(([v])=>v===value))options.push([value,String(value)]);
    const size=document.createElement('select');size.setAttribute('aria-label',line?'线条粗细':'文字大小');size.dataset.canvasStyle=property;
    options.forEach(([v,label])=>{const option=new Option(line?label:label+' px',String(v),false,v===value);size.append(option);});bar.append(size);
    if(line){const shape=document.createElement('select');shape.setAttribute('aria-label','线条样式');shape.dataset.canvasStyle='type';[['line','线条'],['arrow','箭头']].forEach(([v,label])=>shape.append(new Option(label,v,false,item.type===v)));bar.append(shape);}
    const button=(action,label)=>{const el=document.createElement('button');el.type='button';el.dataset.canvasAction=action;el.textContent=label;bar.append(el);};
    if(!line)button('edit','编辑文字');button('duplicate','复制');button('delete','删除');button('done','完成');
  }
  function edit(id){
    if(!select(id))return;const item=current();if(!item||isLine(item))return;
    if(editing?.id===id){editing.focus();return;}
    closeDetail();clearProjects();const el=element(id),body=el?.querySelector('.canvas-item-text');if(!body)return;
    const input=document.createElement('textarea');input.className='canvas-text-editor';input.value=item.text;input.setAttribute('aria-label',item.type==='note'?'便签内容':'画板文字内容');input.placeholder=item.type==='note'?'记录想法、讨论或待办…':'输入文字…';input.spellcheck=false;body.replaceWith(input);el.classList.add('editing');editing={id,input,focus:()=>input.focus({preventScroll:true})};
    input.addEventListener('input',()=>{
      const live=items().find(row=>row.id===id);if(!live)return;live.text=input.value;
      const style=getComputedStyle(el),padding=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);input.style.height='auto';const height=input.scrollHeight;
      live.h=Math.max(live.h,height+padding);el.style.height=live.h+'px';input.style.height='100%';
      pending=true;onEditing();clearTimeout(timer);timer=setTimeout(flush,700);
    });
    input.addEventListener('blur',()=>{if(editing?.input===input)finishEditing();});
    input.addEventListener('keydown',e=>{if(e.key==='Escape'||((e.metaKey||e.ctrlKey)&&e.key==='Enter')){e.preventDefault();e.stopPropagation();if(finishEditing())element(id)?.focus({preventScroll:true});}});
    input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
  }
  function fitText(item){
    if(isLine(item)||!item.text)return;
    const probe=renderCanvasItem(item);probe.style.visibility='hidden';probe.style.pointerEvents='none';probe.removeAttribute('data-canvas-item');world.append(probe);
    const style=getComputedStyle(probe),padding=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);
    item.h=Math.max(item.h,probe.querySelector('.canvas-item-text').scrollHeight+padding);probe.remove();
  }
  function add(item,editText=true){
    if(!finishEditing())return;clearProjects();closeDetail();
    if(!mutate(()=>{getState().canvasItems??=[];getState().canvasItems.push(item);}))return;
    setTool('select');select(item.id);if(editText&&!isLine(item))edit(item.id);else element(item.id)?.focus({preventScroll:true});
  }
  function remove(){const id=selected;if(!id||!finishEditing())return;mutate(()=>getState().canvasItems=items().filter(item=>item.id!==id),'已删除，可用顶部「撤销」恢复');selected=null;renderTools();viewport.focus({preventScroll:true});}
  function duplicate(){const item=current();if(!item||!finishEditing())return;const next=copy(item);next.id='canvas-'+crypto.randomUUID();translateCanvasItem(next,28,28);add(next,false);}
  $('canvasItemTools').addEventListener('change',e=>{const field=e.target.dataset.canvasStyle;if(!field||!current()||!finishEditing())return;const item=current(),value=e.target.value;mutate(()=>{item[field]=['fontSize','strokeWidth'].includes(field)?Number(value):value;if(field==='fontSize')fitText(item);});});
  $('canvasItemTools').addEventListener('click',e=>{const action=e.target.closest('[data-canvas-action]')?.dataset.canvasAction;if(!action)return;if(action==='edit')edit(selected);if(action==='duplicate')duplicate();if(action==='delete')remove();if(action==='done')clear();});
  function hint(){const state=getState(),el=$('canvasToolHint');el.hidden=!kinds.has(state.tool)||state.display!=='canvas'||state.mode==='gather';el.textContent=isLine({type:state.tool})?'拖出'+labels[state.tool]+' · Shift 约束方向 · Esc 取消':'点击放置'+labels[state.tool]+'，或拖出大小 · Esc 取消';}
  function onToolChange(){if(kinds.has(getState().tool)){clear();closeDetail();clearProjects();}else if(getState().tool!=='select')clear();hint();renderTools();}
  function sync(){hint();renderTools();}
  function preview(item){world.querySelector('[data-canvas-draft]')?.remove();const el=renderCanvasItem(item,{selected:true});delete el.dataset.canvasItem;el.dataset.canvasDraft='true';el.style.pointerEvents='none';el.setAttribute('aria-hidden','true');world.append(el);}
  function snapEnd(start,end,shift){if(!shift)return end;const angle=Math.round(Math.atan2(end.y-start.y,end.x-start.x)/(Math.PI/4))*Math.PI/4,length=Math.hypot(end.x-start.x,end.y-start.y);return{x:start.x+Math.cos(angle)*length,y:start.y+Math.sin(angle)*length};}
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  viewport.addEventListener('pointerdown',e=>{
    const state=getState();if(state.display!=='canvas'||state.mode==='gather'||isPanning(e)||e.button!==0)return;
    const target=e.target.closest('[data-canvas-item]');
    if(e.target.closest('textarea,input,select,a')||(e.target.closest('button')&&!e.target.closest('[data-canvas-resize],[data-canvas-endpoint]')))return;
    if(!kinds.has(state.tool)&&!target){clear();return;}
    if(state.tool!=='select'&&!kinds.has(state.tool))return;
    if(!finishEditing()){stop(e);return;}
    const point=toWorld(e.clientX,e.clientY);clearProjects();closeDetail();
    if(kinds.has(state.tool)){const item=createCanvasItem(state.tool,point);drag={type:'create',item,start:point,moved:false};preview(item);}
    else{const id=target.dataset.canvasItem;select(id);const item=current();if(!item)return;const endpoint=e.target.closest('[data-canvas-endpoint]')?.dataset.canvasEndpoint;drag={type:endpoint?'endpoint':e.target.closest('[data-canvas-resize]')?'resize':'move',id,start:point,old:copy(item),endpoint,moved:false};}
    viewport.setPointerCapture(e.pointerId);stop(e);
  },true);
  viewport.addEventListener('pointermove',e=>{
    if(!drag)return;const g=drag,p=toWorld(e.clientX,e.clientY),dx=p.x-g.start.x,dy=p.y-g.start.y;
    if(Math.abs(dx)+Math.abs(dy)>4/getState().view.z)g.moved=true;
    if(g.type==='create'){
      if(g.moved){if(isLine(g.item)){const end=snapEnd(g.start,p,e.shiftKey);g.item.x2=end.x;g.item.y2=end.y;}else{g.item.x=Math.min(p.x,g.start.x);g.item.y=Math.min(p.y,g.start.y);g.item.w=Math.max(100,Math.abs(dx));g.item.h=Math.max(g.item.type==='note'?80:48,Math.abs(dy));}}preview(g.item);
    }else if(g.moved){
      const item=items().find(row=>row.id===g.id);if(!item)return;Object.assign(item,copy(g.old));
      if(g.type==='move')translateCanvasItem(item,dx,dy);
      if(g.type==='resize'){item.w=Math.max(100,g.old.w+dx);item.h=Math.max(item.type==='note'?80:48,g.old.h+dy);}
      if(g.type==='endpoint'){const start=g.endpoint==='end'?{x:item.x,y:item.y}:{x:item.x2,y:item.y2},end=snapEnd(start,p,e.shiftKey);if(g.endpoint==='end'){item.x2=end.x;item.y2=end.y;}else{item.x=end.x;item.y=end.y;}}
      refresh(g.id);
    }
    stop(e);
  },true);
  function finishDrag(e,cancel=false){
    if(!drag)return;const g=drag;drag=null;world.querySelector('[data-canvas-draft]')?.remove();
    if(e?.pointerId!==undefined&&viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
    if(cancel){if(g.old){const item=items().find(row=>row.id===g.id);if(item)Object.assign(item,g.old);refresh(g.id);}if(e)stop(e);return;}
    suppressClick=true;setTimeout(()=>suppressClick=false,80);
    if(g.type==='create')add(g.item);else if(g.moved){const item=items().find(row=>row.id===g.id);if(item&&g.type==='resize')fitText(item);save();refresh(g.id);renderTools();}else{element(g.id)?.focus({preventScroll:true});const stamp=Date.now();if(lastClick?.id===g.id&&stamp-lastClick.time<400){lastClick=null;edit(g.id);}else lastClick={id:g.id,time:stamp};}
    if(e)stop(e);
  }
  viewport.addEventListener('pointerup',e=>finishDrag(e),true);
  viewport.addEventListener('pointercancel',e=>finishDrag(e,true),true);
  viewport.addEventListener('wheel',e=>{if(drag)stop(e);},{capture:true,passive:false});
  world.addEventListener('focusin',e=>{const item=e.target.closest('[data-canvas-item]');if(item&&!e.target.closest('textarea,input,button')&&selected!==item.dataset.canvasItem){clearProjects();select(item.dataset.canvasItem);}});
  world.addEventListener('click',e=>{if(e.target.closest('[data-canvas-item]')){e.stopPropagation();if(suppressClick)return;const item=e.target.closest('[data-canvas-item]');if(!e.target.closest('textarea,input,button'))select(item.dataset.canvasItem);}},true);
  world.addEventListener('dblclick',e=>{const target=e.target.closest('[data-canvas-item]');if(!target||e.target.closest('textarea,button'))return;e.preventDefault();e.stopImmediatePropagation();edit(target.dataset.canvasItem);},true);
  document.addEventListener('keydown',e=>{
    if(getState().display!=='canvas'||getState().mode==='gather'||e.target.closest('input,textarea,select,[contenteditable="true"],[data-project-flow],[data-resize-frame],[data-frame-head],[data-color-menu],[data-color-trigger],.detail-panel,[data-instance]')||document.querySelector('dialog[open]'))return;
    if(drag&&e.key!=='Escape'){stop(e);return;}
    if(e.key==='Escape'&&(drag||selected||kinds.has(getState().tool))){if(drag)finishDrag(null,true);clear();setTool('select');stop(e);return;}
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&['t','n','l','a'].includes(e.key.toLowerCase())){setTool({t:'text',n:'note',l:'line',a:'arrow'}[e.key.toLowerCase()]);stop(e);return;}
    if(e.key==='Enter'&&kinds.has(getState().tool)&&!e.target.closest('button')){const r=viewport.getBoundingClientRect();add(createCanvasItem(getState().tool,toWorld(r.left+r.width/2-120,r.top+r.height/2-80)));stop(e);return;}
    if(!selected)return;
    if(e.key==='Delete'||e.key==='Backspace'){remove();stop(e);return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){duplicate();stop(e);return;}
    if(e.key==='Enter'&&!e.target.closest('button')){edit(selected);stop(e);return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!e.target.closest('button')){const step=e.shiftKey?10:1,item=current();mutate(()=>translateCanvasItem(item,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));element(selected)?.focus({preventScroll:true});stop(e);}
  },true);
  window.addEventListener('blur',()=>{if(drag)finishDrag(null,true);flush();});
  return {render,refresh,flush,clear,sync,onToolChange,bounds:()=>items().map(canvasItemBounds)};
}
