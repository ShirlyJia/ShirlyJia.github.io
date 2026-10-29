const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=value=>/^#[0-9a-f]{6}$/i.test(value||'');

/** One named family, with restrained tones for surfaces, accents and readable ink. */
export const COLOR_PRESETS=Object.freeze([
  {name:'石墨',accent:'#74736c',surface:'#e9e8e4',ink:'#494a46'},
  {name:'雾蓝',accent:'#6284a0',surface:'#e0e9f1',ink:'#45627d'},
  {name:'鼠尾草',accent:'#668777',surface:'#e0eae2',ink:'#496a58'},
  {name:'暖沙',accent:'#9b8671',surface:'#eee5d5',ink:'#7c6750'},
  {name:'陶土',accent:'#b77d68',surface:'#f1e2da',ink:'#955f4d'},
  {name:'灰紫',accent:'#9080a1',surface:'#e9e3ef',ink:'#716081'},
  {name:'青灰',accent:'#65898b',surface:'#deebea',ink:'#426d70'},
  {name:'藕灰',accent:'#ad7e86',surface:'#f0e1e5',ink:'#895d69'}
].map(Object.freeze));

export function colorChoices(variant='accent'){
  const key=['accent','surface','ink'].includes(variant)?variant:'accent';
  return COLOR_PRESETS.map(p=>({name:p.name,value:p[key]}));
}

/** Keep existing custom colors intact until a user chooses a named replacement. */
export function colorPickerMarkup(value,attribute,id,label,options={}){
  if(!/^data-[a-z][a-z0-9-]*$/.test(attribute))throw Error('颜色控件属性无效');
  const variant=['accent','surface','ink'].includes(options.variant)?options.variant:'accent';
  const selected=hex(value)?value:colorChoices(variant)[0].value;
  const name=colorChoices(variant).find(p=>p.value.toLowerCase()===selected.toLowerCase())?.name||'当前颜色';
  const key=attribute+':'+id+':'+(options.inputId||'');
  return '<span class="color-control preset-color-control" data-color-control>'+
    '<input type="hidden" data-color-value '+attribute+'="'+esc(id)+'"'+(options.name?' name="'+esc(options.name)+'"':'')+(options.inputId?' id="'+esc(options.inputId)+'"':'')+' value="'+esc(selected)+'">'+
    '<button type="button" class="preset-color-trigger" data-color-trigger data-color-key="'+esc(key)+'" data-color-variant="'+variant+'" data-color-label="'+esc(label)+'" aria-label="'+esc(label)+'" aria-haspopup="menu" aria-expanded="false" title="'+esc(label)+' · '+esc(name)+'">'+
    '<span class="preset-color-dot" style="background:'+selected+'" aria-hidden="true"></span></button></span>';
}

/** Delegation survives app rerenders. The menu lives outside the transformed canvas. */
export function installColorPickers(){
  let current=null;
  const matchingTrigger=key=>[...document.querySelectorAll('[data-color-trigger]')].find(el=>el.dataset.colorKey===key);
  function close(restoreFocus=false){
    if(!current)return;
    const {menu,trigger,key}=current;current=null;
    trigger.setAttribute('aria-expanded','false');
    if(typeof menu.hidePopover==='function'&&menu.matches(':popover-open'))menu.hidePopover();
    menu.remove();
    if(restoreFocus)(trigger.isConnected?trigger:matchingTrigger(key))?.focus({preventScroll:true});
  }
  function position(){
    if(!current)return;
    const {menu,trigger}=current;
    if(!trigger.isConnected){close();return;}
    const r=trigger.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    menu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-width-8))+'px';
    const below=r.bottom+7;
    menu.style.top=Math.max(8,Math.min(below+height<=window.innerHeight-8?below:r.top-height-7,window.innerHeight-height-8))+'px';
  }
  function open(trigger){
    if(current?.trigger===trigger){close(true);return;}
    close();
    const input=trigger.closest('[data-color-control]')?.querySelector('[data-color-value]');
    if(!input)return;
    const menu=document.createElement('div');menu.className='preset-color-menu';menu.dataset.colorMenu='';menu.setAttribute('role','menu');menu.setAttribute('aria-label',trigger.dataset.colorLabel||'选择颜色');
    const choices=colorChoices(trigger.dataset.colorVariant),known=choices.some(p=>p.value.toLowerCase()===input.value.toLowerCase());
    if(!known&&hex(input.value))choices.unshift({name:'当前颜色',value:input.value});
    menu.innerHTML=choices.map(p=>'<button type="button" class="preset-color-option" role="menuitemradio" aria-checked="'+(p.value.toLowerCase()===input.value.toLowerCase())+'" data-color-choice="'+p.value+'"><span class="preset-color-sample" style="background:'+p.value+'" aria-hidden="true"></span><span>'+esc(p.name)+'</span><span class="preset-color-check" aria-hidden="true">✓</span></button>').join('');
    const hasPopover=typeof menu.showPopover==='function';
    if(hasPopover)menu.setAttribute('popover','manual');
    // Stay inside a modal's non-inert subtree even when the menu enters the top layer.
    (trigger.closest('dialog[open]')||document.body).append(menu);
    current={menu,trigger,input,key:trigger.dataset.colorKey};trigger.setAttribute('aria-expanded','true');
    if(hasPopover)menu.showPopover();
    position();
    (menu.querySelector('[aria-checked="true"]')||menu.querySelector('button')).focus({preventScroll:true});
  }
  const click=e=>{
    const choice=e.target.closest('[data-color-choice]');
    if(choice&&current?.menu.contains(choice)){
      e.preventDefault();e.stopImmediatePropagation();
      const {input,trigger,key}=current,value=choice.dataset.colorChoice;
      if(!hex(value))return;
      close();
      if(value.toLowerCase()!==input.value.toLowerCase()){
        input.value=value;
        trigger.querySelector('.preset-color-dot').style.background=value;
        const name=colorChoices(trigger.dataset.colorVariant).find(p=>p.value.toLowerCase()===value.toLowerCase())?.name||'当前颜色';
        trigger.title=(trigger.dataset.colorLabel||'选择颜色')+' · '+name;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      (trigger.isConnected?trigger:matchingTrigger(key))?.focus({preventScroll:true});
      return;
    }
    const trigger=e.target.closest('[data-color-trigger]');
    if(trigger){e.preventDefault();e.stopImmediatePropagation();open(trigger);}
  };
  const pointer=e=>{if(current&&!current.menu.contains(e.target)&&!current.trigger.contains(e.target))close();};
  const keydown=e=>{
    if(!current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(true);return;}
    if(e.key==='Tab'){close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    e.preventDefault();e.stopImmediatePropagation();
    const buttons=[...current.menu.querySelectorAll('[data-color-choice]')],index=buttons.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus({preventScroll:true});
  };
  document.addEventListener('click',click,true);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',keydown,true);
  window.addEventListener('resize',position);document.addEventListener('scroll',position,true);
  return()=>{close();document.removeEventListener('click',click,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',keydown,true);window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true);};
}
