import {queryWords,searchIndex} from './global-search.js';

export function mountGlobalSearch({input,getIndex,getStatus=()=>'',onQuery,onOpen}) {
  const host=input.closest('.search-wrap'),panel=document.createElement('div');
  panel.id='globalSearchResults';panel.className='global-search-results';panel.hidden=true;host.append(panel);
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls','globalSearchList');input.setAttribute('aria-expanded','false');
  let rows=[],active=-1,timer,composing=false;
  function close(){clearTimeout(timer);timer=null;panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function highlight(node,value){
    const words=queryWords(input.value).sort((a,b)=>b.length-a.length),pattern=words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    if(!pattern){node.textContent=value;return;}
    const regex=new RegExp(pattern,'giu');let at=0;
    for(const match of value.matchAll(regex)){node.append(document.createTextNode(value.slice(at,match.index)));const mark=document.createElement('mark');mark.textContent=match[0];node.append(mark);at=match.index+match[0].length;}
    node.append(document.createTextNode(value.slice(at)));
  }
  function select(index){active=index;const nodes=panel.querySelectorAll('[role="option"]');nodes.forEach((n,i)=>n.setAttribute('aria-selected',String(i===active)));if(nodes[active]){input.setAttribute('aria-activedescendant',nodes[active].id);nodes[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function open(index){const row=rows[index];if(!row)return;close();onOpen(row);}
  function render(){
    clearTimeout(timer);timer=null;if(composing)return;
    const query=input.value;onQuery(query);if(!query.trim()){close();return;}
    rows=searchIndex(getIndex(),query);panel.replaceChildren();
    const count=document.createElement('div');count.className='global-search-count';count.setAttribute('role','status');count.textContent=rows.length?`${rows.length} 条结果`:'未找到相关内容';if(getStatus()){const status=document.createElement('span');status.className='global-search-notice';status.textContent=getStatus();count.append(status);}panel.append(count);
    const list=document.createElement('div');list.id='globalSearchList';list.setAttribute('role','listbox');list.setAttribute('aria-label','全局搜索结果');panel.append(list);
    rows.forEach((row,index)=>{const button=document.createElement('button');button.type='button';button.id='globalSearchOption'+index;button.className='global-search-result';button.setAttribute('role','option');button.setAttribute('aria-selected','false');
      const title=document.createElement('strong'),meta=document.createElement('small'),snippet=document.createElement('span');highlight(title,row.title);meta.textContent=[({project:'项目',frame:'分组',board:'看板',annotation:'便签／文字',meeting:'会议'})[row.type],row.meta].filter(Boolean).join(' · ');highlight(snippet,(row.matchLabel?row.matchLabel+'：':'')+row.excerpt);button.append(meta,title,snippet);button.addEventListener('click',()=>open(index));button.addEventListener('pointerenter',()=>select(index));list.append(button);});
    panel.hidden=false;input.setAttribute('aria-expanded','true');select(-1);
  }
  input.addEventListener('input',()=>{clearTimeout(timer);if(!composing)timer=setTimeout(render,100);});
  input.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});input.addEventListener('compositionend',()=>{composing=false;render();});
  input.addEventListener('focus',()=>{if(input.value.trim())render();});
  input.addEventListener('keydown',event=>{
    if(event.isComposing||composing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(['ArrowDown','ArrowUp','Enter'].includes(event.key)){
      if(timer||panel.hidden)render();
      if(!rows.length)return;event.preventDefault();event.stopPropagation();
      if(event.key==='Enter')open(active<0?0:active);else select((active+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);
    }
  });
  document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))close();});
  host.addEventListener('focusout',event=>{if(!host.contains(event.relatedTarget))close();});
  panel.addEventListener('pointerdown',event=>event.preventDefault());
  return {close,refresh(){if(!panel.hidden)render();}};
}
