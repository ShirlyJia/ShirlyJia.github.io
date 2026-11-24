import {orderedTags} from './tag-editor.js?v=20261030-tag-counts';

const triggerSelector='[data-project-tag-trigger]';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const projectTagNameKey=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase();
const check='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';
const plus='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9m-4.5-4.5h9"/></svg>';
const search='<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.5" cy="7.5" r="4.5"/><path d="m11 11 4 4"/></svg>';

export const projectTagTriggerMarkup='<button type="button" class="project-tag-trigger" data-project-tag-trigger aria-haspopup="dialog" aria-expanded="false" aria-controls="projectTagPicker">'+plus+'<span>标签</span></button>';

/** edit() writes through the workspace's normal save and undo path. */
export function mountProjectTagPicker({root,getProject,getTags,edit}) {
  let current=null,openTimer,closeTimer;
  const within=(entry,target)=>target instanceof Node&&(entry.trigger.contains(target)||entry.panel.contains(target));
  function close(restoreFocus=false){
    clearTimeout(openTimer);clearTimeout(closeTimer);
    if(!current)return;
    const {trigger,panel}=current;current=null;
    trigger.setAttribute('aria-expanded','false');
    panel.remove();
    if(restoreFocus&&trigger.isConnected)trigger.focus({preventScroll:true});
  }
  function position(){
    if(!current)return;
    const {trigger,panel}=current;
    if(!trigger.isConnected||getProject()?.id!==current.projectId){close();return;}
    const rect=trigger.getBoundingClientRect(),bounds=root.getBoundingClientRect(),viewport=window.visualViewport;
    const scroller=trigger.closest('.detail-body')?.getBoundingClientRect();
    if(scroller&&(rect.bottom<=scroller.top||rect.top>=scroller.bottom)){close();return;}
    const top=viewport?.offsetTop||0,leftEdge=viewport?.offsetLeft||0;
    const right=leftEdge+(viewport?.width||innerWidth),bottom=top+(viewport?.height||innerHeight);
    const margin=10,gap=3,viewWidth=viewport?.width||innerWidth;
    const width=Math.min(320,viewWidth-margin*2,Math.max(210,bounds.width-24));
    const left=Math.min(right-width-margin,Math.max(leftEdge+margin,bounds.left+12,Math.min(rect.left,bounds.right-width-12)));
    const below=bottom-margin-rect.bottom-gap,above=rect.top-gap-top-margin;
    panel.style.width=width+'px';panel.style.left=left+'px';
    const desired=panel.scrollHeight+current.list.scrollHeight-current.list.clientHeight;
    const preferred=current.opensBelow??(below>=Math.min(desired,380)||below>=above);
    const space=preferred?below:above,other=preferred?above:below;
    const opensBelow=current.opensBelow=space<126&&other>space?!preferred:preferred;
    panel.style.maxHeight=Math.max(126,Math.min(380,opensBelow?below:above))+'px';
    const y=opensBelow?rect.bottom+gap:rect.top-gap-panel.offsetHeight;
    panel.style.top=Math.max(top+margin,Math.min(y,bottom-margin-panel.offsetHeight))+'px';
  }
  function active(index,scroll=false){
    const {list,input}=current,items=[...list.querySelectorAll('[role=option]')],item=items[index];
    current.active=item?index:-1;
    items.forEach((el,i)=>el.classList.toggle('is-active',i===current.active));
    if(!item){input.removeAttribute('aria-activedescendant');return;}
    input.setAttribute('aria-activedescendant',item.id);
    if(scroll){
      const r=item.getBoundingClientRect(),bounds=list.getBoundingClientRect();
      if(r.top<bounds.top)list.scrollTop+=r.top-bounds.top;
      if(r.bottom>bounds.bottom)list.scrollTop+=r.bottom-bounds.bottom;
    }
  }
  function render(preserveActive=false){
    const {input,list,count,empty}=current,project=getProject(),tags=orderedTags(getTags());
    const filter=projectTagNameKey(input.value),selected=new Set(project.tagIds);
    const previousKey=preserveActive?list.querySelector('.is-active')?.dataset.projectTagChoice:null;
    const words=filter.split(/\s+/);
    const matches=tags.filter(tag=>words.every(word=>projectTagNameKey(tag.name).includes(word)));
    const create=Boolean(filter&&!matches.some(tag=>projectTagNameKey(tag.name)===filter));
    const scroll=list.scrollTop;
    list.innerHTML=matches.map((tag,i)=>{
      const chosen=selected.has(tag.id),color=/^#[0-9a-f]{6}$/i.test(tag.color)?tag.color:'#85867f';
      return '<button type="button" role="option" tabindex="-1" id="projectTagOption'+i+'" class="project-tag-option" data-project-tag-choice="'+esc(tag.id)+'" aria-selected="'+chosen+'"><span class="project-tag-dot" style="background:'+color+'" aria-hidden="true"></span><span>'+esc(tag.name)+'</span><span class="project-tag-check">'+check+'</span></button>';
    }).join('')+(create?'<button type="button" role="option" tabindex="-1" id="projectTagOption'+matches.length+'" class="project-tag-option project-tag-create" data-project-tag-create aria-selected="false">'+plus+'<span>新建「'+esc(input.value.trim())+'」</span></button>':'');
    empty.hidden=Boolean(matches.length||create);
    count.textContent='已选 '+selected.size;
    list.scrollTop=preserveActive?scroll:0;
    active(previousKey==null?-1:matches.findIndex(tag=>tag.id===previousKey));
    position();
  }
  function choose(button,keyboard=false){
    const entry=current;
    if(!entry||!button||getProject()?.id!==entry.projectId)return;
    entry.pinned=true;
    clearTimeout(closeTimer);
    const create=button.hasAttribute('data-project-tag-create');
    const choice=create?{name:entry.input.value.trim()}:{id:button.dataset.projectTagChoice,selected:button.getAttribute('aria-selected')!=='true'};
    if(!edit(entry.projectId,choice)||current!==entry)return;
    if(create)entry.input.value='';
    if(keyboard)entry.input.focus({preventScroll:true});
    render(!create);
  }
  function show(trigger,pinned=false,focus=false){
    if(!getProject())return;
    clearTimeout(openTimer);clearTimeout(closeTimer);
    if(current?.trigger===trigger){
      current.pinned||=pinned;
      if(focus)current.input.focus({preventScroll:true});
      return;
    }
    close();
    const panel=document.createElement('section');
    panel.id='projectTagPicker';panel.className='project-tag-picker';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','项目标签');
    panel.innerHTML='<div class="project-tag-search">'+search+'<input type="search" role="combobox" aria-label="搜索标签" aria-autocomplete="list" aria-expanded="true" aria-controls="projectTagOptions" placeholder="搜索标签…" maxlength="40" autocomplete="off" spellcheck="false"></div><div id="projectTagOptions" class="project-tag-options" role="listbox" aria-label="可选标签" aria-multiselectable="true"></div><p class="project-tag-empty" hidden>还没有标签，输入名称即可新建。</p><footer><span role="status"></span><button type="button" class="project-tag-done">完成</button></footer>';
    const popover=typeof panel.showPopover==='function';
    if(popover)panel.setAttribute('popover','manual');
    root.append(panel);
    const input=panel.querySelector('input'),list=panel.querySelector('[role=listbox]');
    current={projectId:getProject().id,trigger,panel,input,list,count:panel.querySelector('[role=status]'),empty:panel.querySelector('.project-tag-empty'),pinned,active:-1};
    trigger.setAttribute('aria-expanded','true');
    if(popover)panel.showPopover();
    render();
    if(!current)return;
    if(focus)input.focus({preventScroll:true});
    input.addEventListener('input',event=>{if(!event.isComposing)render();});
    input.addEventListener('compositionend',()=>render());
    panel.addEventListener('mousedown',event=>{if(event.target.closest('[role=option]'))event.preventDefault();});
    panel.addEventListener('click',event=>{
      if(event.target.closest('.project-tag-done')){close(true);return;}
      choose(event.target.closest('[role=option]'),event.detail===0);
    });
    panel.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();close(true);return;}
      if(event.target!==input)return;
      const items=list.querySelectorAll('[role=option]');
      if(!items.length)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        active((current.active<0?(event.key==='ArrowDown'?0:items.length-1):
          (current.active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length),true);
      }else if(event.key==='Enter'){
        event.preventDefault();
        if(current.active<0&&!input.value.trim()){active(0,true);return;}
        const candidate=current.active>=0?items[current.active]:[...items].find(item=>!item.hasAttribute('data-project-tag-create'));
        if(candidate)choose(candidate,true);
        else active(0,true); // Creation needs an explicit selection, unlike toggling an existing tag.
      }
    });
    panel.addEventListener('pointerover',event=>{
      if(event.pointerType==='mouse'&&event.target.closest('[role=option]'))active(-1);
    });
  }
  root.addEventListener('click',event=>{
    const trigger=event.target.closest(triggerSelector);if(!trigger)return;
    if(current?.trigger===trigger&&current.pinned){close(true);return;}
    show(trigger,true,event.detail===0||matchMedia('(hover:hover) and (pointer:fine)').matches);
  });
  root.addEventListener('keydown',event=>{
    const trigger=event.target.closest(triggerSelector);if(!trigger)return;
    if(event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();show(trigger,true,true);}
    if(event.key==='Escape'&&current?.trigger===trigger){event.preventDefault();event.stopPropagation();close(true);}
  });
  root.addEventListener('pointerover',event=>{
    if(event.pointerType!=='mouse')return;
    if(current&&within(current,event.target))clearTimeout(closeTimer);
    const trigger=event.target.closest(triggerSelector);
    if(!trigger||current?.trigger===trigger||trigger.contains(event.relatedTarget))return;
    clearTimeout(openTimer);openTimer=setTimeout(()=>{if(trigger.isConnected)show(trigger);},150);
  });
  root.addEventListener('pointerout',event=>{
    if(event.pointerType!=='mouse')return;
    const trigger=event.target.closest(triggerSelector);
    if(trigger&&!trigger.contains(event.relatedTarget))clearTimeout(openTimer);
    if(!current||current.pinned||!within(current,event.target)||within(current,event.relatedTarget))return;
    clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(current&&!current.pinned&&!current.panel.contains(document.activeElement))close();},240);
  });
  root.addEventListener('focusout',event=>{
    if(current&&event.relatedTarget&&within(current,event.target)&&!within(current,event.relatedTarget))close();
  });
  document.addEventListener('pointerdown',event=>{
    if(current&&!within(current,event.target))close();
    else if(!event.target.closest(triggerSelector))clearTimeout(openTimer);
  },true);
  document.addEventListener('keydown',event=>{
    if(!current||event.key!=='Escape'||current.panel.contains(event.target)||current.trigger.contains(event.target))return;
    if(event.defaultPrevented||event.isComposing)return;
    event.preventDefault();event.stopPropagation();close(true);
  },true);
  window.addEventListener('resize',position);
  document.addEventListener('scroll',event=>{if(current&&!current.panel.contains(event.target))position();},true);
  window.visualViewport?.addEventListener('resize',position);
  window.visualViewport?.addEventListener('scroll',position);
  return {close};
}
