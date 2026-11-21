import {restoreTextSelection,textSelection} from './rich-history.js?v=20261117-full-editor';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=content=>`<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
const icons={
  undo:icon('<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3"/>'),
  redo:icon('<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12h3"/>'),
  brush:icon('<rect x="3" y="3" width="12" height="6" rx="1"/><path d="M15 6h5v7l-9 2v6H8v-8l9-2V9"/>'),
  align:icon('<path d="M3 5h18M3 10h12M3 15h18M3 20h12"/>'),
  ordered:icon('<text x="2" y="7">1</text><text x="2" y="14">2</text><text x="2" y="21">3</text><path d="M10 5h11M10 12h11M10 19h11"/>'),
  bullets:icon('<circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/><path d="M10 5h11M10 12h11M10 19h11"/>'),
  task:icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/>'),
  quote:icon('<path d="M10 5H6a3 3 0 0 0-3 3v7h7V9H3m18-4h-4a3 3 0 0 0-3 3v7h7V9h-7"/>'),
  indent:icon('<path d="M3 5h18M3 19h18M13 10h8M13 14h8M3 12h6m-3-3 3 3-3 3"/>'),
  divider:icon('<path d="M3 12h18M3 5h3m4 0h4m4 0h3M3 19h3m4 0h4m4 0h3"/>'),
  table:icon('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  image:icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 6"/>'),
  link:icon('<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8"/>'),
  code:icon('<path d="M8 3H6v7l-3 2 3 2v7h2m8-18h2v7l3 2-3 2v7h-2"/>'),
  emoji:icon('<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M7 14a5 5 0 0 0 10 0"/>'),
  highlight:icon('<path d="m10 3 8 8-7 7-8-8 7-7Zm-6 9-2 6h6m5-12 5 5"/><path d="M3 22h18" style="stroke:var(--rich-highlight-color,#f7d86b);stroke-width:3"/>')
};
const tool=(command,title,label,menu=false)=>`<button type="button" data-rich-command="${command}" title="${title}" aria-label="${title}"${menu?' aria-haspopup="menu" aria-expanded="false"':''}>${label}</button>`;
const separator='<span class="rich-tool-separator" aria-hidden="true"></span>';
const chevron='<span class="rich-color-chevron" aria-hidden="true">⌄</span>';
export function richToolbarMarkup(){
  return tool('undo','撤销（⌘/Ctrl Z）',icons.undo)+tool('redo','重做（⌘/Ctrl Shift Z）',icons.redo)+tool('formatPainter','格式刷',icons.brush)+separator+
    tool('textStyle','文字样式','<span class="rich-type-icon">Aa</span>'+chevron,true)+
    tool('foreColor','文字颜色','<span class="rich-color-letter" aria-hidden="true">A</span>'+chevron,true)+
    tool('highlight','文字高亮',icons.highlight+chevron,true)+separator+
    tool('bold','加粗','<b>B</b>')+tool('italic','斜体','<i>I</i>')+tool('underline','下划线','<u>U</u>')+tool('strikeThrough','删除线','<s>S</s>')+separator+
    tool('alignment','对齐方式',icons.align+chevron,true)+tool('insertOrderedList','编号列表',icons.ordered)+tool('insertUnorderedList','项目符号',icons.bullets)+tool('taskList','任务列表',icons.task)+tool('blockquote','引用',icons.quote)+tool('indentation','缩进',icons.indent+chevron,true)+separator+
    tool('divider','分隔线',icons.divider)+tool('table','表格',icons.table,true)+tool('image','插入图片',icons.image)+tool('link','链接',icons.link,true)+tool('code','代码',icons.code,true)+tool('emoji','表情',icons.emoji,true);
}
const fonts={default:'',sans:'Arial, "Microsoft YaHei", sans-serif',serif:'Georgia, SimSun, serif',mono:'ui-monospace, SFMono-Regular, Consolas, monospace'};
export function safeFontFamily(value){
  const text=String(value??'').replace(/["']/g,'').toLowerCase();
  if(/^(ui-monospace|sfmono-regular|consolas|courier new|monospace)(\s*,|$)/.test(text))return fonts.mono;
  if(/^(georgia|simsun|宋体|times new roman|serif)(\s*,|$)/.test(text))return fonts.serif;
  if(/^(arial|microsoft yahei|微软雅黑|sans-serif)(\s*,|$)/.test(text))return fonts.sans;
  return '';
}
export function safeFontSize(value){const match=String(value??'').trim().match(/^(\d+(?:\.\d+)?)(px|pt)$/i);if(!match)return '';const px=Number(match[1])*(match[2].toLowerCase()==='pt'?4/3:1);return px>=10&&px<=72?Math.round(px*10)/10+'px':'';}
export function copyRichStyles(source,target,safeColor){
  const style=source.style||{},color=safeColor(style.color||(source.tagName==='FONT'?source.getAttribute('color'):'')),background=safeColor(style.backgroundColor);
  if(color)target.style.color=color;if(background)target.style.backgroundColor=background;
  const font=safeFontFamily(style.fontFamily||source.getAttribute('face')),size=safeFontSize(style.fontSize)||({1:'10px',2:'13px',3:'16px',4:'18px',5:'24px',6:'32px',7:'48px'}[source.tagName==='FONT'?source.getAttribute('size'):'']);
  if(font)target.style.fontFamily=font;if(size)target.style.fontSize=size;
  if(/^(left|center|right|justify)$/.test(style.textAlign||source.getAttribute('align')||''))target.style.textAlign=style.textAlign||source.getAttribute('align');
  if(/^(bold|[6-9]00)$/.test(style.fontWeight))target.style.fontWeight='700';
  if(style.fontStyle==='italic')target.style.fontStyle='italic';
  const decoration=(style.textDecorationLine||style.textDecoration||'').split(/\s+/).filter(v=>['underline','line-through'].includes(v));if(decoration.length)target.style.textDecorationLine=decoration.join(' ');
  if(/^(P|DIV|H[123]|LI|PRE|BLOCKQUOTE)$/.test(target.tagName)&&/^\d+(?:\.\d+)?px$/.test(style.marginLeft)){const value=Number.parseFloat(style.marginLeft);if(value>0&&value<=320)target.style.marginLeft=value+'px';}
}
let activePopup=null;
const emojis=[['😀','开心'],['😊','微笑'],['😎','自信'],['🤔','思考'],['👍','赞'],['👏','鼓掌'],['🙌','庆祝'],['🤝','合作'],['✅','完成'],['☑️','勾选'],['❗','注意'],['❓','问题'],['💡','想法'],['📌','置顶'],['🎯','目标'],['🚀','启动'],['🔥','重点'],['⭐','星标'],['❤️','喜欢'],['💬','讨论'],['📝','记录'],['📅','日期'],['⏳','等待'],['🔍','查找'],['📊','数据'],['📎','附件'],['🔗','链接'],['🧩','模块'],['🛠️','修复'],['📦','交付'],['🎉','庆祝完成'],['❄️','冻结']];
export function mountRichFormatting({editor,wrapper,state,listen,remember,selectRange,edit,insertHTML,addImages,safeLink,safeColor,colorChoices}){
  const toolbar=wrapper.querySelector('.rich-toolbar');
  const range=()=>{const s=window.getSelection();return s?.rangeCount&&editor.contains(s.getRangeAt(0).commonAncestorContainer)?s.getRangeAt(0):null;};
  const anchor=()=>{const node=range()?.startContainer;return node?.nodeType===1?node:node?.parentElement;};
  const inside=selector=>{const node=anchor()?.closest(selector);return node&&editor.contains(node)&&node!==editor?node:null;};
  const command=(name,value=null)=>document.execCommand(name,false,value);
  function close(){
    if(!state.popup)return;const {menu,trigger,controller}=state.popup;state.popup=null;controller.abort();menu.remove();trigger?.setAttribute('aria-expanded','false');wrapper.classList.remove('rich-menu-open');if(activePopup===close)activePopup=null;
  }
  function open(name,html,onAction,{className='',focus=true}={}){
    if(state.popup?.name===name){close();selectRange(editor,state.range);return;}
    activePopup?.();remember();state.history?.boundary();activePopup=close;
    const menu=document.createElement('div'),controller=new AbortController(),trigger=toolbar.querySelector(`[data-rich-command="${name}"]`);
    menu.className='rich-format-menu '+className;menu.setAttribute('role','dialog');menu.setAttribute('aria-label',trigger.getAttribute('aria-label'));menu.innerHTML=html;
    if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');
    (wrapper.closest('dialog[open]')||document.body).append(menu);state.popup={name,menu,controller,trigger};wrapper.classList.add('rich-menu-open');trigger.setAttribute('aria-expanded','true');
    if(typeof menu.showPopover==='function')menu.showPopover();
    const position=()=>{if(!editor.isConnected){close();return;}const r=trigger.getBoundingClientRect(),w=menu.offsetWidth,h=menu.offsetHeight;menu.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+6+h<=innerHeight-8?r.bottom+6:r.top-h-6,innerHeight-h-8))+'px';};position();
    const on=(target,type,fn,options={})=>target.addEventListener(type,fn,{...options,signal:controller.signal});
    on(menu,'pointerdown',event=>{event.stopPropagation();if(event.target.closest('button'))event.preventDefault();});
    on(menu,'click',event=>{event.stopPropagation();const button=event.target.closest('[data-rich-action]');if(button)onAction(button.dataset.richAction,button,menu);});
    on(menu,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();selectRange(editor,state.range);return;}if(event.target.matches('input,select,textarea'))return;
      const buttons=[...menu.querySelectorAll('button:not([disabled]),input,select')];const index=buttons.indexOf(document.activeElement);
      if(event.key==='Tab'){event.preventDefault();buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();}
      if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const delta=className.includes('rich-table-menu')&&event.target.hasAttribute('data-cols')&&['ArrowDown','ArrowUp'].includes(event.key)?8:1;const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowUp','ArrowLeft'].includes(event.key)?-delta:delta)+buttons.length)%buttons.length;buttons[next]?.focus();}
    });
    on(document,'pointerdown',event=>{if(!menu.contains(event.target)&&!trigger.contains(event.target))close();},{capture:true});on(window,'resize',position);on(document,'scroll',position,{capture:true});
    if(focus)(menu.querySelector('[autofocus]')||menu.querySelector('button,input,select'))?.focus({preventScroll:true});
    return {menu,on,position};
  }
  const row=(action,label,extra='')=>`<button type="button" data-rich-action="${action}" ${extra}>${label}</button>`;
  function apply(operation){close();selectRange(editor,state.range);edit(editor,operation);remember();}
  function normalizeSize(value){
    if(!editor.querySelector('font[size="7"]'))return;const bookmark=textSelection(editor);
    editor.querySelectorAll('font[size="7"]').forEach(font=>{const span=document.createElement('span');copyRichStyles(font,span,safeColor);span.style.fontSize=value;span.append(...font.childNodes);font.replaceWith(span);});restoreTextSelection(editor,bookmark);
  }
  function inlineSize(value){state.nextFontSize=value;command('styleWithCSS',false);command('fontSize','7');normalizeSize(value);}
  function blocks(){
    let selection=range();if(!selection)return [];
    if(!inside('p,div,li,h1,h2,h3,pre,blockquote,td,th')){command('formatBlock','p');selection=range();}
    if(selection.collapsed){const current=inside('p,div,li,h1,h2,h3,pre,blockquote,td,th');return current?[current]:[];}
    return [...editor.querySelectorAll('p,div,li,h1,h2,h3,pre,blockquote,td,th')].filter(node=>selection.intersectsNode(node)&&![...node.children].some(child=>child.matches('p,div,li,h1,h2,h3,pre,blockquote,td,th,ul,ol')));
  }
  function indent(delta){if(inside('li'))command(delta>0?'indent':'outdent');else blocks().forEach(node=>{const width=Math.max(0,Math.min(320,(Number.parseFloat(node.style.marginLeft)||0)+32*delta));node.style.marginLeft=width?width+'px':'';});}
  function selectContents(node){const selection=document.createRange();selection.selectNodeContents(node);selectRange(editor,selection);}
  function insertBlock(html,selector){
    const id='rich-insert-'+Math.random().toString(36).slice(2);insertHTML(editor,html.replace('<'+selector,'<'+selector+' data-rich-insert="'+id+'"'));
    const node=editor.querySelector(`[data-rich-insert="${id}"]`);if(node){node.removeAttribute('data-rich-insert');selectContents(node.querySelector('td,th,code')||node);}
  }
  function colorMenu(highlight){
    const name=highlight?'highlight':'foreColor',selected=safeColor(document.queryCommandValue(highlight?'hiliteColor':'foreColor'));
    const choices=[{name:highlight?'无高亮':'默认颜色',value:highlight?'transparent':'#37352f'},...colorChoices(highlight?'surface':'ink')];
    open(name,choices.map(c=>row(c.value,`<span class="rich-color-sample" style="${highlight?'background':'color'}:${c.value}" aria-hidden="true">A</span><span>${esc(c.name)}</span><span class="rich-color-check" aria-hidden="true">✓</span>`,`data-rich-color="${c.value}" role="menuitemradio" aria-checked="${selected===c.value}"`)).join(''),value=>apply(()=>command(highlight?'hiliteColor':'foreColor',value)),{className:'rich-color-menu'});
  }
  function textStyles(){
    const current=(document.queryCommandValue('formatBlock')||'p').toLowerCase();
    const popup=open('textStyle',[['p','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3']].map(([tag,label])=>row(tag,`<span class="rich-style-${tag}">${label}</span>`,`aria-pressed="${current===tag}"`)).join('')+'<hr><div class="rich-style-settings"><label>字体<select data-rich-font aria-label="字体"><option value="default">默认字体</option><option value="sans">无衬线</option><option value="serif">衬线 / 宋体</option><option value="mono">等宽字体</option></select></label><label>字号<select data-rich-size aria-label="字号"><option value="">默认字号</option>'+[12,14,16,18,20,24,30,36,48,64].map(size=>`<option value="${size}px">${size}</option>`).join('')+'</select></label></div><hr>'+row('clear','清除文字格式'),action=>apply(()=>{if(action==='clear'){state.nextFontSize=null;command('removeFormat');command('formatBlock','p');}else command('formatBlock',action);}),{className:'rich-style-menu'});
    if(!popup)return;const font=popup.menu.querySelector('[data-rich-font]'),size=popup.menu.querySelector('[data-rich-size]');
    const node=state.range?.startContainer,currentElement=node?.nodeType===1?node:node?.parentElement;
    const computed=currentElement?getComputedStyle(currentElement):getComputedStyle(editor),actualFont=safeFontFamily(computed.fontFamily);font.value=Object.keys(fonts).find(key=>fonts[key]===actualFont)||'default';
    size.value=safeFontSize(computed.fontSize);popup.on(font,'change',()=>apply(()=>command('fontName',fonts[font.value]||'-apple-system, BlinkMacSystemFont, sans-serif')));popup.on(size,'change',()=>apply(()=>inlineSize(size.value||getComputedStyle(editor).fontSize)));
  }
  function linkMenu(){
    const link=inside('a'),selection=range(),selected=selection?.toString()||'',initial=link?.textContent||selected;
    const popup=open('link','<form class="rich-link-form"><label>显示文字<input name="label" aria-label="链接文字" value="'+esc(initial)+'" placeholder="选中文字或填写名称"></label><label>链接地址<input name="url" aria-label="链接地址" value="'+esc(link?.getAttribute('href')||safeLink(selected))+'" placeholder="https://" autofocus></label><p class="rich-menu-error" role="alert" hidden></p><div class="rich-menu-actions">'+(link?row('unlink','移除链接'):'')+'<button type="submit" class="rich-menu-primary">确定</button></div></form>',action=>{if(action==='unlink')apply(()=>{const bookmark=textSelection(editor);link.replaceWith(...link.childNodes);restoreTextSelection(editor,bookmark);});},{className:'rich-link-menu'});
    if(!popup)return;popup.on(popup.menu.querySelector('form'),'submit',event=>{
      event.preventDefault();const form=event.currentTarget,href=safeLink(form.elements.url.value),label=form.elements.label.value.trim()||href;
      if(!href){const error=form.querySelector('[role=alert]');error.textContent='请输入 http、https 或 mailto 链接。';error.hidden=false;form.elements.url.focus();return;}
      apply(()=>{if(link){link.href=href;if(label!==initial)link.textContent=label;link.target='_blank';link.rel='noopener noreferrer';}
        else if(selected&&label===selected){command('createLink',href);editor.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});}
        else insertHTML(editor,`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
      });
    });
  }
  function editTable(action,cell){
    const table=cell.closest('table'),rowNode=cell.parentElement,rowIndex=[...table.rows].indexOf(rowNode),column=cell.cellIndex,rows=[...table.rows];let focusCell=cell;
    if(action==='deleteTable'){const p=document.createElement('p');p.innerHTML='<br>';table.replaceWith(p);selectContents(p);return;}
    if(action==='rowBefore'||action==='rowAfter'){const newRow=document.createElement('tr');newRow.innerHTML=Array.from(rowNode.cells,()=>'<td><br></td>').join('');rowNode[action==='rowBefore'?'before':'after'](newRow);focusCell=newRow.cells[column];}
    if(action==='colBefore'||action==='colAfter')rows.forEach(row=>{const reference=row.cells[Math.min(column,row.cells.length-1)],next=document.createElement(reference?.tagName==='TH'?'th':'td');next.innerHTML='<br>';reference?.[action==='colBefore'?'before':'after'](next);if(row===rowNode)focusCell=next;});
    if(action==='deleteRow'){focusCell=rows[rowIndex+1]?.cells[column]||rows[rowIndex-1]?.cells[column];rowNode.remove();}
    if(action==='deleteCol'){rows.forEach(row=>row.cells[column]?.remove());focusCell=rowNode.cells[column]||rowNode.cells[column-1];}
    if(!table.querySelector('td,th')){const p=document.createElement('p');p.innerHTML='<br>';table.replaceWith(p);focusCell=p;}
    if(focusCell)selectContents(focusCell);
  }
  function tableMenu(){
    const cell=inside('td,th');
    if(cell){const merged=Boolean(cell.closest('table').querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])'));
      const actions=[['rowBefore','上方插入行'],['rowAfter','下方插入行'],['colBefore','左侧插入列'],['colAfter','右侧插入列'],['deleteRow','删除当前行'],['deleteCol','删除当前列'],['deleteTable','删除表格']];
      open('table',(merged?'<p class="rich-menu-note">合并单元格表格可直接编辑内容。</p>':'')+actions.filter(([action])=>!merged||action==='deleteTable').map(([action,label])=>row(action,label)).join(''),action=>apply(()=>editTable(action,cell)));return;
    }
    const popup=open('table','<p class="rich-table-size" aria-live="polite">选择行列</p><div class="rich-table-grid">'+Array.from({length:48},(_,i)=>row('insert',`<span aria-hidden="true"></span>`,`data-rows="${Math.floor(i/8)+1}" data-cols="${i%8+1}" aria-label="插入 ${Math.floor(i/8)+1} 行 ${i%8+1} 列表格"`)).join('')+'</div>',(_,button)=>{const rows=Number(button.dataset.rows),cols=Number(button.dataset.cols);apply(()=>insertBlock('<table><tbody>'+Array.from({length:rows},(_,i)=>'<tr>'+Array.from({length:cols},()=>i===0?'<th><br></th>':'<td><br></td>').join('')+'</tr>').join('')+'</tbody></table><p><br></p>','table'));},{className:'rich-table-menu'});
    if(!popup)return;const preview=event=>{const cell=event.target.closest('[data-cols]');if(!cell)return;const rows=Number(cell.dataset.rows),cols=Number(cell.dataset.cols);popup.menu.querySelector('.rich-table-size').textContent=rows+' 行 × '+cols+' 列';popup.menu.querySelectorAll('[data-cols]').forEach(button=>button.classList.toggle('is-included',Number(button.dataset.rows)<=rows&&Number(button.dataset.cols)<=cols));};popup.on(popup.menu,'pointerover',preview);popup.on(popup.menu,'focusin',preview);
  }
  function codeMenu(){open('code',row('inline','行内代码')+row('block','代码块'),action=>apply(()=>{
    const existing=inside(action==='inline'?'code':'pre');if(existing){const bookmark=textSelection(editor);if(existing.tagName==='PRE'){const p=document.createElement('p');p.textContent=existing.textContent;existing.replaceWith(p);}else existing.replaceWith(...existing.childNodes);restoreTextSelection(editor,bookmark);return;}
    const text=range()?.toString()||'代码';if(action==='inline')insertBlock('<code>'+esc(text)+'</code>','code');else insertBlock('<pre><code>'+esc(text)+'</code></pre><p><br></p>','pre');
  }));}
  function stopPainter(){state.brush=null;wrapper.classList.remove('rich-painting');toolbar.querySelector('[data-rich-command=formatPainter]').setAttribute('aria-pressed','false');state.message('');}
  function painter(){
    if(state.brush){stopPainter();return;}const node=anchor()||editor,computed=getComputedStyle(node),block=inside('p,div,h1,h2,h3,li');
    let background='transparent';for(let element=node;element&&element!==editor;element=element.parentElement){if(safeColor(element.style.backgroundColor)){background=element.style.backgroundColor;break;}}
    state.brush={bold:document.queryCommandState('bold'),italic:document.queryCommandState('italic'),underline:document.queryCommandState('underline'),strikeThrough:document.queryCommandState('strikeThrough'),color:computed.color,background,size:safeFontSize(computed.fontSize),font:safeFontFamily(computed.fontFamily),block:block?.tagName.toLowerCase(),align:block?getComputedStyle(block).textAlign:'left'};
    wrapper.classList.add('rich-painting');toolbar.querySelector('[data-rich-command=formatPainter]').setAttribute('aria-pressed','true');state.message('选中目标文字应用格式，Esc 取消。');
  }
  listen(editor,'mouseup',()=>{if(!state.brush||!state.editing)return;const selected=range();if(!selected)return;const brush=state.brush;stopPainter();
    edit(editor,()=>{if(selected.collapsed){const target=inside('p,div,h1,h2,h3,li,td,th');if(target)selectContents(target);}
      for(const type of ['bold','italic','underline','strikeThrough'])if(Boolean(document.queryCommandState(type))!==Boolean(brush[type]))command(type);
      command('foreColor',brush.color);command('hiliteColor',brush.background);command('fontName',brush.font||'-apple-system, BlinkMacSystemFont, sans-serif');if(brush.size)inlineSize(brush.size);
      if(['p','h1','h2','h3'].includes(brush.block))command('formatBlock',brush.block);
      command(({left:'justifyLeft',center:'justifyCenter',right:'justifyRight',justify:'justifyFull'})[brush.align]||'justifyLeft');
    });remember();
  });
  listen(editor,'pointerdown',()=>{state.nextFontSize=null;});
  listen(editor,'keydown',event=>{
    if(/^(Arrow|Home|End)/.test(event.key))state.nextFontSize=null;
    if(event.key==='Escape'&&state.brush){event.preventDefault();stopPainter();}
    if(!state.editing||state.composing||event.defaultPrevented)return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();remember();linkMenu();return;}
    if(inside('pre')){
      if(event.key==='Enter'){event.preventDefault();edit(editor,()=>{if(event.metaKey||event.ctrlKey){const p=document.createElement('p');p.innerHTML='<br>';inside('pre').after(p);selectContents(p);}else command('insertText','\n');});remember();}
      if(event.key==='Tab'){event.preventDefault();edit(editor,()=>command('insertText','  '));remember();}return;
    }
    const cell=inside('td,th');if(event.key==='Tab'&&cell){event.preventDefault();edit(editor,()=>{const cells=[...cell.closest('table').querySelectorAll('td,th')],index=cells.indexOf(cell),next=cells[index+(event.shiftKey?-1:1)];if(next)selectContents(next);else if(!event.shiftKey){editTable('rowAfter',cell);const first=cell.parentElement.nextElementSibling?.cells[0];if(first)selectContents(first);}});remember();}
    else if(event.key==='Tab'&&inside('li')){event.preventDefault();edit(editor,()=>indent(event.shiftKey?-1:1));remember();}
  });
  const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp,image/gif';upload.multiple=true;upload.hidden=true;upload.setAttribute('aria-label','选择图片');wrapper.append(upload);
  listen(upload,'change',()=>{if(upload.files.length)addImages(upload.files);upload.value='';});
  listen(toolbar,'keydown',event=>{event.stopPropagation();if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...toolbar.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length]?.focus();});
  state.closeTools=()=>{close();stopPainter();};state.controller.signal.addEventListener('abort',()=>{close();upload.remove();},{once:true});
  return {normalizeInput(){if(state.nextFontSize)normalizeSize(state.nextFontSize);},handle(name){
    if(name==='foreColor'||name==='highlight')colorMenu(name==='highlight');
    else if(name==='textStyle')textStyles();
    else if(name==='alignment')open(name,[['justifyLeft','左对齐'],['justifyCenter','居中对齐'],['justifyRight','右对齐'],['justifyFull','两端对齐']].map(([action,label])=>row(action,label)).join(''),action=>apply(()=>command(action)));
    else if(name==='indentation')open(name,row('increase','增加缩进')+row('decrease','减少缩进'),action=>apply(()=>indent(action==='increase'?1:-1)));
    else if(name==='divider')apply(()=>insertHTML(editor,'<hr><p><br></p>'));
    else if(name==='table')tableMenu();else if(name==='link')linkMenu();else if(name==='code')codeMenu();
    else if(name==='emoji')open(name,emojis.map(([emoji,label])=>row(emoji,emoji,`aria-label="${label}" title="${label}"`)).join(''),value=>apply(()=>command('insertText',value)),{className:'rich-emoji-menu'});
    else if(name==='image'){close();remember();upload.click();}
    else if(name==='formatPainter'){close();selectRange(editor,state.range);painter();}
    else return false;return true;
  }};
}
