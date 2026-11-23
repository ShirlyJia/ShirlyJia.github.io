/** Small shared editor. Rich HTML is optional; plain text stays available to cards/search. */
import {safeImageWidth,mountImageResize} from './rich-image-resize.js';
import {colorChoices} from './color-presets.js';
import {richToolbarMarkup,copyRichStyles,mountRichFormatting} from './rich-formatting.js?v=20261123-inline-citations';
import {createRichHistory,textSelection,restoreTextSelection} from './rich-history.js?v=20261117-full-editor';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const supportedImages = /^image\/(png|jpeg|webp|gif)$/i;
const imageData = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const MAX_IMAGE_DATA = 850000;
const mounts = new WeakMap();
const defaultTextColor = '#37352f';
const allowTags = new Set('P DIV BR STRONG B EM I U S STRIKE DEL H1 H2 H3 UL OL LI BLOCKQUOTE PRE CODE A IMG HR TABLE THEAD TBODY TFOOT TR TH TD FIGURE FIGCAPTION'.split(' '));
const dropTags = new Set('SCRIPT STYLE IFRAME FRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON TEXTAREA SELECT OPTION META LINK BASE AUDIO VIDEO SOURCE TEMPLATE NOSCRIPT'.split(' '));
const blockTags = new Set('P DIV H1 H2 H3 LI BLOCKQUOTE PRE TABLE TR FIGURE FIGCAPTION'.split(' '));

export function safeRichLink(value, base) {
  if(typeof value!=='string'||!value.trim())return '';
  try { const url = new URL(value.trim(),base||undefined); return ['https:','http:','mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function webLink(value) {
  const href=safeRichLink(value);
  return /^https?:\/\//i.test(href)?href:'';
}
function makeLink(href) {
  const link=document.createElement('a');
  link.href=href;link.target='_blank';link.rel='noopener noreferrer';
  return link;
}
function citationSource(url) {
  const host=url.hostname.replace(/^www\./i,'');
  const icon=host==='github.com'?'github':
    host==='gitlab.com'||/^gitlab[.-]/.test(host)||/\/-\/(?:merge_requests|issues|commit|blob|tree|releases)\//.test(url.pathname)?'gitlab':'web';
  return {host,icon};
}
function compactLink(href) {
  if(!webLink(href))return null;
  const url=new URL(href),{host,icon}=citationSource(url);
  const parts=url.pathname.split('/').filter(Boolean).map(part=>{
    try{return decodeURIComponent(part);}catch{return part;}
  });
  const gitHub=icon==='github',gitLab=icon==='gitlab',separator=parts.indexOf('-');
  if((gitHub||gitLab)&&parts.length>=2){
    const repoEnd=gitHub?2:separator>=2?separator:parts.length;
    const repo=parts.slice(0,repoEnd).join('/').replace(/\.git$/i,'');
    const [kind,id]=parts.slice(gitLab&&separator>=2?repoEnd+1:repoEnd);
    const suffix=kind==='pull'&&/^\d+$/.test(id)?'PR #'+id:
      kind==='merge_requests'&&/^\d+$/.test(id)?'MR !'+id:
      kind==='issues'&&/^\d+$/.test(id)?'Issue #'+id:
      kind==='commit'&&id?id.slice(0,8):
      kind==='blob'&&id?parts.at(-1):kind==='tree'&&id?id:'';
    return {label:repo+(suffix?' · '+suffix:''),kind:'git'};
  }
  const tail=parts.at(-1);
  return {label:host+(tail?' · '+(tail.length>38?tail.slice(0,36)+'…':tail):''),kind:'web'};
}
function decorateLink(link,preview) {
  if(preview){
    link.dataset.richLink=preview.kind;
    link.title=link.href;
  }
}
export function safeRichImage(value) { return typeof value === 'string' && value.length <= MAX_IMAGE_DATA && imageData.test(value) ? value : ''; }
/** Retain text colour only; pasted CSS never becomes an arbitrary inline style. */
export function safeTextColor(value) {
  const color=String(value??'').trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/.test(color))return color;
  if(/^#[0-9a-f]{3}$/.test(color))return '#'+[...color.slice(1)].map(c=>c+c).join('');
  const named={black:'#000000',white:'#ffffff',red:'#ff0000',blue:'#0000ff',green:'#008000',gray:'#808080',grey:'#808080',orange:'#ffa500',purple:'#800080',brown:'#a52a2a',yellow:'#ffff00',teal:'#008080',navy:'#000080'};
  if(Object.hasOwn(named,color))return named[color];
  const rgb=color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(1(?:\.0+)?)\s*)?\)$/);
  if(!rgb||rgb.slice(1,4).some(v=>Number(v)>255))return '';
  return '#'+rgb.slice(1,4).map(v=>Number(v).toString(16).padStart(2,'0')).join('');
}
function copyStyles(node,target) { copyRichStyles(node,target,safeTextColor); }
function plainHTML(value) { return String(value ?? '').split(/\r?\n/).map(line => `<div>${esc(line) || '<br>'}</div>`).join(''); }
function taskBox(checked, interactive = false) {
  const box=document.createElement('span');box.dataset.richTaskBox='';box.contentEditable='false';
  if(interactive){box.setAttribute('role','checkbox');box.setAttribute('aria-checked',String(checked));box.setAttribute('aria-label',checked?'标记未完成':'标记完成');box.tabIndex=0;}
  else box.setAttribute('aria-hidden','true');
  return box;
}

/** Rebuild supported elements, without storing presentation-only citation wrappers. */
function cleanRichHTML(html, plain = '', {sourceURL = ''} = {}) {
  if (!html || typeof html !== 'string' || typeof document === 'undefined') return plainHTML(plain);
  const source = document.createElement('template'); source.innerHTML = html;
  const output = document.createElement('div');
  const base=webLink(sourceURL);
  function copy(node, parent) {
    if (node.nodeType === 3) { parent.append(document.createTextNode(node.nodeValue)); return; }
    if (node.nodeType !== 1 || dropTags.has(node.tagName)) return;
    if(node.tagName==='SPAN'&&node.hasAttribute('data-rich-task-box'))return;
    if (node.tagName === 'IMG') {
      const src = safeRichImage(node.getAttribute('src'));
      if (!src) return;
      const img = document.createElement('img'); img.src = src; img.alt = node.getAttribute('alt') || '图片'; img.draggable = false;
      const width=safeImageWidth(node.getAttribute('width'));if(width!==null)img.setAttribute('width',width);
      parent.append(img); return;
    }
    if (!allowTags.has(node.tagName)) {
      let next = parent;
      const span=document.createElement('span');copyStyles(node,span);
      if(span.hasAttribute('style')){next.append(span);next=span;}
      for (const child of node.childNodes) copy(child, next);
      return;
    }
    if (node.tagName === 'A') {
      const raw=node.getAttribute('href')||node.getAttribute('data-href');
      const href = safeRichLink(raw,base)||(raw?.startsWith('//')?webLink('https:'+raw):'');
      if (!href) { for (const child of node.childNodes) copy(child, parent); return; }
      const link = makeLink(href);
      copyStyles(node,link);
      if(node.hasAttribute('data-rich-link'))decorateLink(link,compactLink(href));
      parent.append(link); for (const child of node.childNodes) copy(child, link); return;
    }
    const element = document.createElement(node.tagName.toLowerCase());
    copyStyles(node,element);
    if(['TD','TH'].includes(node.tagName)){for(const key of ['colspan','rowspan']){const value=node.getAttribute(key);if(/^\d{1,2}$/.test(value||'')&&Number(value)>1&&Number(value)<=20)element.setAttribute(key,value);}}
    if(node.tagName==='OL'&&/^\d{1,4}$/.test(node.getAttribute('start')||''))element.setAttribute('start',node.getAttribute('start'));
    if(node.tagName==='UL'&&node.getAttribute('data-rich-list')==='task')element.dataset.richList='task';
    if(node.tagName==='LI'&&parent.matches('ul[data-rich-list="task"]')){
      const checked=node.getAttribute('data-rich-task')==='true';element.dataset.richTask=String(checked);element.append(taskBox(checked));
    }
    parent.append(element); for (const child of node.childNodes) copy(child, element);
  }
  for (const child of source.content.childNodes) copy(child, output);
  return output.innerHTML;
}
const citationInline='span,strong,b,em,i,u,s,strike,del';
const citationGap=/^\s*(?:[·•・]\s*)?$/u;
function citationUnit(link,root) {
  // Include formatting around a link only when it wraps no other content.
  let unit=link,parent=unit.parentElement;
  while(parent&&parent!==root&&parent.matches(citationInline)&&parent.childElementCount===1&&
      [...parent.childNodes].every(node=>node===unit||node.nodeType===3&&!node.nodeValue.trim())){
    unit=parent;parent=unit.parentElement;
  }
  return unit;
}
function decorateCitations(root) {
  const links=new Map();
  for(const link of root.querySelectorAll('a[href]')){
    const href=webLink(link.getAttribute('href'));
    if(!href||!link.textContent.trim()||link.closest('pre,code,[data-rich-citation]')||link.querySelector('img,br,p,div,li,table'))continue;
    link.title=href;
    links.set(citationUnit(link,root),citationSource(new URL(href)));
  }
  for(const [first,source] of links){
    const run=[first];let last=first;
    for(;;){
      let next=last.nextSibling,separator='';
      const gap=[];
      while(next&&(next.nodeType===3||next.nodeType===1&&!links.has(next)&&next.matches(citationInline)&&!next.childElementCount&&citationGap.test(next.textContent))){
        separator+=next.textContent;gap.push(next);next=next.nextSibling;
      }
      const neighbor=links.get(next);
      if(!citationGap.test(separator)||!neighbor||neighbor.host!==source.host||neighbor.icon!==source.icon)break;
      run.push(...gap,next);links.delete(next);last=next;
    }
    const citation=document.createElement('span'),labels=document.createElement('span');
    citation.dataset.richCitation=source.icon;labels.dataset.richCitationLabels='';
    first.before(citation);citation.append(labels);
    labels.append(...run);
  }
}
function refreshCitations(editor) {
  const selection=textSelection(editor);
  for(const [wrapper,attribute] of [['[data-rich-citation-labels]','data-rich-citation-labels'],['[data-rich-citation]','data-rich-citation']]){
    for(const node of editor.querySelectorAll(wrapper)){
      if(node.hasAttribute('style'))node.removeAttribute(attribute);
      else node.replaceWith(...node.childNodes);
    }
  }
  decorateCitations(editor);
  if(selection)restoreTextSelection(editor,selection);
}
/** Reading and pasting use the same inline presentation. Each link stays independent. */
export function richHTML(html, plain = '', options) {
  const clean=cleanRichHTML(html,plain,options);
  if(typeof document==='undefined'||!/<a\b/i.test(clean))return clean;
  const holder=document.createElement('div');holder.innerHTML=clean;
  decorateCitations(holder);
  return holder.innerHTML;
}
function plainFromHTML(html) {
  const holder = document.createElement('div'); holder.innerHTML = html;
  function walk(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'IMG') return '[图片]';
    if (node.tagName === 'BR') return '\n';
    const body = Array.from(node.childNodes).map(walk).join('');
    if(['TD','TH'].includes(node.tagName))return body+'\t';
    if(node.tagName==='LI'&&node.hasAttribute('data-rich-task'))return (node.dataset.richTask==='true'?'☑ ':'☐ ')+body+'\n';
    return blockTags.has(node.tagName) ? body + '\n' : body;
  }
  return Array.from(holder.childNodes).map(walk).join('').replace(/\u00a0/g,' ').replace(/\t+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/\n+$/,'');
}
function splitClipboardHTML(html) {
  if(!html)return {fragment:'',sourceURL:''};
  const header=html.match(/^Version:[^\r\n]*(?:\r?\n(?:StartHTML|EndHTML|StartFragment|EndFragment|StartSelection|EndSelection|SourceURL):[^\r\n]*)+\r?\n/i)?.[0]||'';
  const body=html.slice(header.length),start=/<!--\s*StartFragment\s*-->/i.exec(body),end=/<!--\s*EndFragment\s*-->/i.exec(body);
  let sourceURL=webLink(header.match(/^SourceURL:\s*([^\r\n]+)/im)?.[1]);
  if(!sourceURL&&/<base\b/i.test(body)){
    const source=document.createElement('template');source.innerHTML=body;
    sourceURL=webLink(source.content.querySelector('base[href]')?.getAttribute('href'));
  }
  return {fragment:start&&end&&end.index>=start.index+start[0].length?body.slice(start.index+start[0].length,end.index):body,sourceURL};
}
function bareLink(value, {reference=false} = {}) {
  const text=value.trim();
  if(/^(?:https?:\/\/|mailto:|www\.|(?:github\.com|gitlab\.com)(?=\/|$))[^\s<>"'\x60]*$/i.test(text)){
    return safeRichLink(/^(?:https?:\/\/|mailto:)/i.test(text)?text:'https://'+text);
  }
  return reference&&/^\/\/[^/\s<>"'\x60][^\s<>"'\x60]*$/.test(text)?webLink('https:'+text):'';
}
function linkText(value) {
  const fragment=document.createDocumentFragment();let cursor=0;
  // Prefer Markdown's explicit label to an automatically generated one.
  const tokens=/(?<code>\x60+[^\x60\n]+\x60+)|\[(?<label>(?:\\.|[^\]\\\n])+)\]\((?<destination><[^>\n]+>|(?:\\[()]|\([^()\s]*\)|[^\s()])+)(?:[ \t]+["'][^"'\n]*["'])?\)|(?<url>(?:(?:https?:\/\/|mailto:|www\.)[^\s<>"'\x60，。；！？、（）【】《》「」『』“”‘’：…]+|(?:github\.com|gitlab\.com)\/[^\s<>"'\x60，。；！？、（）【】《》「」『』“”‘’：…]+))/gi;
  for(const match of value.matchAll(tokens)){
    const {code,label,destination,url}=match.groups;
    if(code||label&&value[match.index-1]==='!'||url&&match.index>0&&/[\w@./-]/.test(value[match.index-1]))continue;
    let candidate=destination?destination.replace(/^<|>$/g,'').replace(/\\([()])/g,'$1'):url.replace(/[.,;:!?]+$/,'');
    if(url)for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
      while(candidate.endsWith(close)&&candidate.split(close).length>candidate.split(open).length)candidate=candidate.slice(0,-1);
    }
    const href=bareLink(candidate,{reference:Boolean(destination)});if(!href)continue;
    fragment.append(document.createTextNode(value.slice(cursor,match.index)));
    const link=makeLink(href),preview=label?null:compactLink(href);
    link.textContent=label?label.replace(/\\([\\[\]()])/g,'$1'):preview?.label||candidate;
    decorateLink(link,preview);fragment.append(link);
    cursor=match.index+(url?candidate.length:match[0].length);
  }
  if(!cursor)return null;
  fragment.append(document.createTextNode(value.slice(cursor)));return fragment;
}
/** Keep copied anchor labels. Only bare web addresses get a generated display label. */
export function pastedRichHTML(html, plain = '', {urls = [], markdown = ''} = {}) {
  const {fragment,sourceURL}=splitClipboardHTML(html);
  const holder=document.createElement('div');holder.innerHTML=cleanRichHTML(fragment,'',{sourceURL});
  const htmlText=holder.textContent.trim(),plainText=plain.trim();
  const anchors=holder.querySelectorAll('a'),assets=holder.querySelector('img,hr,table,pre,code');
  if(urls.length&&!anchors.length&&!assets){
    const text=htmlText||plainText;
    if(!text&&!markdown){
      for(const href of urls){
        const preview=compactLink(href);if(!preview)continue;
        const link=makeLink(webLink(href));
        link.textContent=preview.label;decorateLink(link,preview);
        if(urls.length>1){
          const line=document.createElement('div');line.append(link);holder.append(line);
        }else holder.append(link);
      }
      return holder.innerHTML;
    }
    const href=urls.length===1?webLink(urls[0]):'';
    if(href&&!/\r|\n/.test(text)&&!bareLink(text)&&!linkText(text)&&(!htmlText||!plainText||htmlText===plainText||bareLink(plainText)===href)){
      const link=makeLink(href);
      if(htmlText)link.append(...holder.childNodes);else link.textContent=text;
      holder.append(link);return holder.innerHTML;
    }
  }
  if(!anchors.length&&!assets){
    const linkParts=[...holder.querySelectorAll('strong,b,em,i,u,s,del,[style]')];
    const partialLabel=linkParts.some(node=>node.textContent.trim()!==htmlText);
    if(!htmlText||bareLink(plainText)&&htmlText===plainText&&(!linkParts.length||partialLabel)){
      const text=markdown||plain;
      holder.innerHTML=text&&!/\r|\n/.test(text)?esc(text):text?plainHTML(text):'';
    }
  }
  for(const link of holder.querySelectorAll('a')){
    const href=link.getAttribute('href');
    if(link.hasAttribute('data-rich-link')||link.children.length||link.closest('pre,code')||bareLink(link.textContent)!==href)continue;
    const preview=compactLink(href);
    if(preview){link.textContent=preview.label;decorateLink(link,preview);}
  }
  const walker=document.createTreeWalker(holder,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())if(!walker.currentNode.parentElement.closest('a,pre,code'))nodes.push(walker.currentNode);
  for(const node of nodes){
    const content=linkText(node.nodeValue);if(content)node.replaceWith(content);
  }
  return holder.innerHTML;
}
function transferredRichContent(data) {
  const html=data.getData('text/html'),plain=data.getData('text/plain'),markdown=data.getData('text/markdown');
  const [mozURL,mozTitle]=data.getData('text/x-moz-url').split(/\r?\n/);
  const urls=[...new Set((data.getData('text/uri-list')||mozURL||data.getData('text/x-moz-url-data')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('#')).map(webLink).filter(Boolean))];
  const text=plain||mozTitle||data.getData('text/x-moz-url-desc')||'';
  if(!html&&!text&&!urls.length&&!markdown)return {markup:'',externalImage:false};
  const markup=pastedRichHTML(html,text,{urls,markdown});
  return {markup,hasCitation:/<a\b/i.test(markup),literal:text||markdown||urls.join('\n')||null,externalImage:/<img\b/i.test(html)&&!/<img\b/i.test(markup)};
}
function accompanyingContent(markup) {
  const content=document.createElement('template');content.innerHTML=markup;
  content.content.querySelectorAll('img').forEach(image=>image.remove());
  return content.innerHTML;
}
export function readRichEditor(editor) { const html = cleanRichHTML(editor.innerHTML); return {text:plainFromHTML(html), html}; }
export function setRichEditor(editor, {text = '', html = ''} = {}) {
  if (!editor) return;
  const mounted = mounts.get(editor);
  if (mounted) { mounted.closeTools?.();mounted.resize?.cancel();mounted.revision++; mounted.range = null; mounted.image = null;mounted.nextFontSize=null; }
  editor.innerHTML = richHTML(html, text); syncTaskControls(editor);updateEmpty(editor); updateImageTools(editor);mounted?.history?.reset();
}
export function richHasContent({text = '', html = ''} = {}) { return Boolean(text.trim() || /<img\b/i.test(html)); }
function updateEmpty(editor) { editor.dataset.empty = String(!editor.textContent.trim() && !editor.querySelector('img,hr,ul,ol,blockquote,table,pre')); }
export function richEditorMarkup({value = '', html = '', label = '内容', placeholder = '输入内容，可直接粘贴图片', attrs = '', collapsible = false} = {}) {
  const toolbar=richToolbarMarkup();
  return `<div class="rich-editor${collapsible?' rich-collapsible':''}"><div class="rich-toolbar" role="toolbar" aria-label="${esc(label)}格式"${collapsible?' hidden':''}>${toolbar}</div><div class="rich-editor-input rich-content" contenteditable="${!collapsible}" tabindex="0" role="textbox" aria-readonly="${collapsible}" aria-multiline="true" aria-label="${esc(label)}" data-placeholder="${esc(placeholder)}" spellcheck="false" ${attrs}>${richHTML(html, value)}</div><div class="rich-image-tools" hidden><label>宽度 <input type="number" min="24" max="4096" step="1" data-rich-image-width aria-label="图片宽度"> px</label><button type="button" data-rich-command="resetImageSize">恢复原尺寸</button><button type="button" data-rich-command="removeImage">删除图片</button></div><p class="rich-editor-message" role="status" hidden></p>${collapsible?'<div class="rich-edit-actions" hidden><button type="button" data-rich-done>完成</button></div>':''}</div>`;
}
function taskItem(editor, node) {
  const element=node?.nodeType===1?node:node?.parentElement,item=element?.closest('li');
  return item&&editor.contains(item)&&item.parentElement.matches('ul[data-rich-list="task"]')?item:null;
}
function syncTaskControls(editor) {
  editor.querySelectorAll('[data-rich-task-box]').forEach(box=>{if(box.parentElement.tagName!=='LI'||!box.parentElement.parentElement.matches('ul[data-rich-list="task"]'))box.remove();});
  editor.querySelectorAll('li').forEach(item=>{
    if(!item.parentElement.matches('ul[data-rich-list="task"]')){item.removeAttribute('data-rich-task');return;}
    const checked=item.dataset.richTask==='true';item.dataset.richTask=String(checked);
    const boxes=[...item.children].filter(node=>node.hasAttribute('data-rich-task-box'));
    const box=boxes.shift()||taskBox(checked,true);boxes.forEach(extra=>extra.remove());
    box.removeAttribute('aria-hidden');box.setAttribute('role','checkbox');box.setAttribute('aria-checked',String(checked));box.setAttribute('aria-label',checked?'标记未完成':'标记完成');box.tabIndex=0;
    if(item.firstChild!==box)item.prepend(box);
  });
}
function currentList(editor) {
  const node=window.getSelection()?.anchorNode,element=node?.nodeType===1?node:node?.parentElement,list=element?.closest('ul,ol');
  return list&&editor.contains(list)?list:null;
}
function clearTasks(list) {
  list.removeAttribute('data-rich-list');
  [...list.children].filter(node=>node.tagName==='LI').forEach(item=>{item.removeAttribute('data-rich-task');[...item.children].filter(node=>node.hasAttribute('data-rich-task-box')).forEach(box=>box.remove());});
}
function convertTaskItems(editor,list,enabled) {
  const range=editorRange(editor),items=[...list.children].filter(node=>node.tagName==='LI');
  const anchor=range?.startContainer.nodeType===1?range.startContainer:range?.startContainer.parentElement;
  const selected=items.filter(item=>!range||(range.collapsed?item.contains(anchor):range.intersectsNode(item)));
  if(!selected.length)return;
  const boundary=range&&{start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset};
  const fragment=document.createDocumentFragment();let group=null,previous;
  for(const item of items){
    const asTask=selected.includes(item)?enabled:list.dataset.richList==='task';
    if(!group||previous!==asTask){group=list.cloneNode(false);if(asTask)group.dataset.richList='task';else group.removeAttribute('data-rich-list');fragment.append(group);previous=asTask;}
    group.append(item);if(!asTask)clearTasks(group);
  }
  list.replaceWith(fragment);syncTaskControls(editor);
  if(boundary&&editor.contains(boundary.start)&&editor.contains(boundary.end)){
    const restored=document.createRange();
    restored.setStart(boundary.start,Math.min(boundary.startOffset,boundary.start.nodeType===3?boundary.start.length:boundary.start.childNodes.length));
    restored.setEnd(boundary.end,Math.min(boundary.endOffset,boundary.end.nodeType===3?boundary.end.length:boundary.end.childNodes.length));selectRange(editor,restored);
  }else{const restored=document.createRange();restored.selectNodeContents(selected.at(-1));restored.collapse(false);selectRange(editor,restored);}
}
function toggleTaskList(editor) {
  let list=currentList(editor);
  if(list?.dataset.richList==='task'){convertTaskItems(editor,list,false);return;}
  if(!list||list.tagName!=='UL'){document.execCommand('insertUnorderedList');list=currentList(editor);}
  if(list)convertTaskItems(editor,list,true);
}
function editorRange(editor) {
  const selection = window.getSelection();
  return selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode) ? selection.getRangeAt(0).cloneRange() : null;
}
function selectRange(editor, range) {
  editor.focus({preventScroll:true});
  const selection = window.getSelection();
  if (!range || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }
  selection.removeAllRanges(); selection.addRange(range);
}
function updateImageTools(editor) {
  const state = mounts.get(editor), image = state?.image;
  const controls = editor.closest('.rich-editor')?.querySelector('.rich-image-tools');
  if (controls) controls.hidden = !image || !editor.contains(image);
  editor.querySelectorAll('img').forEach(img => img.classList.toggle('rich-image-selected', img === image));
  state?.resize?.sync();
}
function notify(editor,inputType='') { editor.dispatchEvent(new InputEvent('input', {bubbles:true,inputType})); }
function edit(editor,operation) {
  const state=mounts.get(editor);if(!state){operation();return;}state.history?.begin();state.transactionDepth=(state.transactionDepth||0)+1;
  try{operation();}finally{
    state.transactionDepth--;
    if(!state.transactionDepth){const inputType=state.transactionInputType||'';state.transactionInputType='';notify(editor,inputType);}
    state.history?.end();
  }
}
function insertHTML(editor, html) {
  if (document.execCommand('insertHTML', false, html)) return;
  const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.startContainer)) return;
  const fragment = range.createContextualFragment(html), end = fragment.lastChild;
  range.deleteContents(); range.insertNode(fragment);
  if (end) { range.setStartAfter(end); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
}
function insertTransferredHTML(editor,{markup,hasCitation,literal:text}) {
  const selection=editorRange(editor),start=selection?.startContainer;
  const literal=(start?.nodeType===1?start:start?.parentElement)?.closest('pre,code');
  if(literal&&editor.contains(literal)&&literal.contains(selection.endContainer)){
    document.execCommand('insertText',false,text??plainFromHTML(markup));
    return;
  }
  insertHTML(editor,markup);
  if(!hasCitation)return;
  refreshCitations(editor);
  // Typing after a freshly pasted anchor should continue as ordinary text.
  const caret=editorRange(editor),node=caret?.startContainer;
  const target=(node?.nodeType===1?node:node?.parentElement);
  const link=target?.closest('a');
  if(caret?.collapsed&&link){
    for(const boundary of [link,target?.closest('[data-rich-citation]')]){
      if(!boundary||!editor.contains(boundary))continue;
      const remaining=caret.cloneRange();remaining.setEnd(boundary,boundary.childNodes.length);
      if(!remaining.toString()&&!remaining.cloneContents().querySelector('img,br'))caret.setStartAfter(boundary);
    }
    selectRange(editor,caret);
  }
}
async function prepareImage(file) {
  if (!supportedImages.test(file.type) || /\.svg$/i.test(file.name || '')) throw Error('请选择 PNG、JPEG、WebP 或 GIF 图片。');
  if (file.size > 20 * 1024 * 1024) throw Error('单张图片不能超过 20 MB。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error('无法读取这张图片。');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw Error('当前浏览器无法处理图片。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/png');
    if (data.length > 520000) {
      for (const quality of [.88,.76,.64,.5]) { data = canvas.toDataURL('image/webp', quality); if (data.length <= 520000) break; }
    }
    if (data.length > 520000) {
      const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(canvas.width * .72)); small.height = Math.max(1, Math.round(canvas.height * .72)); small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height); data = small.toDataURL('image/webp', .7);
    }
    if (!safeRichImage(data) || data.length > 620000) throw Error('图片内容过大，请裁剪后再粘贴。');
    return `<img src="${data}" alt="${esc(file.name && file.name !== 'image.png' ? file.name : '粘贴的图片')}" draggable="false"><br>`;
  } finally { URL.revokeObjectURL(url); }
}
export function mountRichEditors(root, {onChange, onError, onCommit} = {}) {
  const editors = root.matches?.('.rich-editor-input') ? [root] : Array.from(root.querySelectorAll('.rich-editor-input'));
  const added = [];
  for (const editor of editors) {
    if (mounts.has(editor)) continue;
    const wrapper = editor.closest('.rich-editor'), controller = new AbortController();
    const state = {range:null, image:null, pending:0, revision:0, onError, controller, composing:false, inputs:0, editing:editor.contentEditable==='true'}; mounts.set(editor,state); added.push(editor);
    const listen = (target,event,fn,options={}) => target.addEventListener(event,fn,{...options,signal:controller.signal});
    const message = (text, error = false) => { const node = wrapper.querySelector('.rich-editor-message'); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error); if (error) onError?.(text,editor); };
    state.message = message;
    state.resize=mountImageResize(editor,{getImage:()=>state.image,notify:()=>notify(editor),message,signal:controller.signal});
    const colorTrigger=wrapper.querySelector('[data-rich-command="foreColor"]');
    const remember = () => {
      const range = editorRange(editor);if(range)state.range=range;state.history?.remember();
      if(range&&colorTrigger){const color=safeTextColor(document.queryCommandValue('foreColor'))||defaultTextColor;colorTrigger.style.setProperty('--rich-text-color',color);const highlight=safeTextColor(document.queryCommandValue('hiliteColor'))||'#f7d86b';wrapper.querySelector('[data-rich-command=highlight]')?.style.setProperty('--rich-highlight-color',highlight);}
      if(range){
        const inTasks=currentList(editor)?.dataset.richList==='task';
        for(const command of ['bold','italic','underline','strikeThrough','insertOrderedList','insertUnorderedList','taskList','blockquote']){
          const button=wrapper.querySelector('[data-rich-command="'+command+'"]');
          const pressed=command==='taskList'?inTasks:command==='blockquote'?document.queryCommandValue('formatBlock')==='blockquote':command==='insertUnorderedList'&&inTasks?false:document.queryCommandState(command);
          button?.setAttribute('aria-pressed',String(Boolean(pressed)));
        }
      }
    };
    const setEditing=(editing,{restoreFocus=true}={})=>{
      if(!editing){
        if(!flushRichEditors(wrapper)||onCommit?.(editor)===false)return;
        state.closeTools?.();state.resize.cancel();state.image=null;updateImageTools(editor);
      }
      state.editing=editing;wrapper.classList.toggle('is-editing',editing);editor.contentEditable=String(editing);editor.setAttribute('aria-readonly',String(!editing));
      wrapper.querySelector('.rich-toolbar').hidden=!editing;
      wrapper.querySelector('.rich-edit-actions').hidden=!editing;
      if(editing)selectRange(editor,state.range);
      else if(restoreFocus)editor.focus({preventScroll:true});
      else if(wrapper.contains(document.activeElement))document.activeElement.blur();
    };
    const toggleTask=box=>{
      const item=box.parentElement;edit(editor,()=>{item.dataset.richTask=String(item.dataset.richTask!=='true');notify(editor);});
      if(!state.editing)onCommit?.(editor);
    };
    if(wrapper.classList.contains('rich-collapsible')){
      listen(wrapper.querySelector('[data-rich-done]'),'click',()=>setEditing(false));
      // Wait for click, not pointerdown: collapsing the editor must not move a
      // control out from under the pointer before its click has been delivered.
      listen(document,'click',event=>{
        if(!state.editing||!editor.isConnected||event.button>0||wrapper.contains(event.target)||state.popup?.menu.contains(event.target))return;
        setEditing(false,{restoreFocus:false});
      },{capture:true});
    }
    const addImages = async (files, accompaniment = '') => {
      if (state.pending) { message('图片正在处理中，请稍候。',true); return; }
      const images = Array.from(files).filter(file => file.type.startsWith('image/'));
      if (!images.length) { message('这里支持插入图片；其他文件请放到资料中。',true); return; }
      if (images.length > 8) { message('一次最多插入 8 张图片。',true); return; }
      remember(); const range = state.range?.cloneRange(), revision = state.revision;
      state.pending++; editor.dataset.richPending = 'true'; message('正在处理图片…');
      try {
        const markup = [accompaniment];
        for (const file of images) markup.push(await prepareImage(file));
        if (!editor.isConnected || state.revision !== revision) return;
        state.pending=0;delete editor.dataset.richPending;message('');
        selectRange(editor, range); edit(editor,()=>{insertHTML(editor, markup.join(''));if(/<a\b/i.test(accompaniment))refreshCitations(editor);}); remember();
      } catch(error) { if (editor.isConnected) message(error.message || '图片插入失败，请重试。',true); }
      finally { state.pending=0; delete editor.dataset.richPending; }
    };
    listen(editor,'input',event=>{state.inputs++;if(state.transactionDepth){state.transactionInputType=event.inputType||state.transactionInputType;event.stopPropagation();return;}if(!state.composing)formatting.normalizeInput();if(event.inputType==='insertParagraph'){const item=taskItem(editor,window.getSelection()?.anchorNode);if(item)item.dataset.richTask='false';}syncTaskControls(editor);updateEmpty(editor);updateImageTools(editor);remember();if(!state.composing)state.history?.record(event.inputType||'');onChange?.(readRichEditor(editor),editor);});
    listen(editor,'compositionstart',()=>state.composing=true); listen(editor,'compositionend',()=>{state.composing=false;remember();const before=state.inputs;queueMicrotask(()=>{if(editor.isConnected&&state.inputs===before)notify(editor);});});
    listen(editor,'keyup',remember); listen(editor,'mouseup',remember); listen(editor,'focus',remember);
    listen(editor,'click',event=>{
      const box=event.target.closest('[data-rich-task-box]');if(box&&editor.contains(box)){event.preventDefault();event.stopPropagation();toggleTask(box);return;}
      const link=event.target.closest('a');
      if(link&&state.editing&&(event.metaKey||event.ctrlKey)){
        event.preventDefault();event.stopPropagation();
        const href=safeRichLink(link.getAttribute('href'));if(href)window.open(href,'_blank','noopener,noreferrer');
        return;
      }
      if(!state.editing){
        if(link)return;
        state.range=editorRange(editor)||document.caretRangeFromPoint?.(event.clientX,event.clientY);setEditing(true);
      }
      state.image=event.target.tagName==='IMG'?event.target:null;updateImageTools(editor);
    });
    listen(document,'pointerdown',event=>{if(state.image&&!wrapper.contains(event.target)&&!state.resize.active){state.image=null;updateImageTools(editor);}});
    listen(editor,'keydown',event=>{
      event.stopPropagation();
      const box=event.target.closest('[data-rich-task-box]');
      if(box&&[' ','Enter'].includes(event.key)){event.preventDefault();toggleTask(box);return;}
      if(!state.editing){
        if(event.target.closest('a'))return;
        if(event.key==='Enter'||event.key==='F2'){event.preventDefault();setEditing(true);}
        else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)setEditing(true);
        else return;
      }
      if(!state.composing&&(event.metaKey||event.ctrlKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();if(!state.pending)state.history[event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo']();remember();return;}
      if(!state.composing&&event.key==='Enter'&&!event.shiftKey&&window.getSelection()?.isCollapsed){
        const item=taskItem(editor,window.getSelection()?.anchorNode);
        if(item&&!item.textContent.trim()&&!item.querySelector('img')){
          event.preventDefault();[...item.children].filter(node=>node.hasAttribute('data-rich-task-box')).forEach(node=>node.remove());
          edit(editor,()=>document.execCommand('insertParagraph'));syncTaskControls(editor);remember();return;
        }
      }
      if (!state.composing && state.image && ['Backspace','Delete'].includes(event.key)) {
        event.preventDefault(); const range=document.createRange();range.selectNode(state.image);selectRange(editor,range);edit(editor,()=>document.execCommand('delete'));state.image=null;updateImageTools(editor);
      }
    });
    listen(editor,'paste',event=>{
      const clipboard=event.clipboardData; if(!clipboard)return;
      if(!state.editing)setEditing(true);
      const files=Array.from(clipboard.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
      const content=transferredRichContent(clipboard),{markup,externalImage}=content;
      event.preventDefault();
      if(files.length){addImages(files,accompanyingContent(markup));return;}
      if(markup){remember();selectRange(editor,state.range);edit(editor,()=>insertTransferredHTML(editor,content));remember();}
      if(externalImage)message('网页图片请复制图片本身后粘贴，或拖入本地图片。',true);
    });
    listen(editor,'dragover',event=>{if(state.editing&&Array.from(event.dataTransfer?.types||[]).some(type=>type==='Files'||/^text\//.test(type))){event.preventDefault();wrapper.classList.add('rich-dragging');}});
    listen(editor,'dragleave',()=>wrapper.classList.remove('rich-dragging'));
    listen(editor,'drop',event=>{wrapper.classList.remove('rich-dragging');if(!state.editing||!event.dataTransfer)return;const files=Array.from(event.dataTransfer.files);event.preventDefault();
      const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(range&&editor.contains(range.startContainer)){selectRange(editor,range);state.range=range.cloneRange();}
      const content=transferredRichContent(event.dataTransfer),{markup,externalImage}=content;
      if(files.length){addImages(files,accompanyingContent(markup));return;}
      if(markup){selectRange(editor,state.range);edit(editor,()=>insertTransferredHTML(editor,content));remember();}
      if(externalImage)message('网页图片请复制图片本身后粘贴，或拖入本地图片。',true);
    });
    listen(wrapper.querySelector('.rich-toolbar'),'mousedown',event=>{if(event.target.closest('button')){remember();event.preventDefault();}});
    listen(wrapper,'click',event=>{
      const command=event.target.closest('[data-rich-command]')?.dataset.richCommand;if(!command)return;event.preventDefault();event.stopPropagation();
      if(command==='undo'||command==='redo'){if(!state.pending&&!state.composing)state.history[command]();remember();return;}
      if(formatting.handle(command))return;
      if(command==='removeImage'){if(state.image){const range=document.createRange();range.selectNode(state.image);selectRange(editor,range);edit(editor,()=>document.execCommand('delete'));state.image=null;updateImageTools(editor);}return;}
      if(command==='resetImageSize'){state.resize.reset();return;}
      selectRange(editor,state.range);
      edit(editor,()=>{
        if(command==='heading')document.execCommand('formatBlock',false,'h3');
        else if(command==='blockquote')document.execCommand('formatBlock',false,document.queryCommandValue('formatBlock')==='blockquote'?'p':'blockquote');
        else if(command==='taskList'){toggleTaskList(editor);notify(editor);}
        else if(['insertOrderedList','insertUnorderedList'].includes(command)&&currentList(editor)?.dataset.richList==='task'){
          if(command==='insertOrderedList')document.execCommand(command);else convertTaskItems(editor,currentList(editor),false);
        }else document.execCommand(command,false,null);
      });
      remember();
    });
    syncTaskControls(editor);updateEmpty(editor);
    state.history=createRichHistory(editor,{read:()=>readRichEditor(editor).html,restore:html=>{state.range=null;state.image=null;state.nextFontSize=null;editor.innerHTML=richHTML(html);syncTaskControls(editor);updateEmpty(editor);updateImageTools(editor);notify(editor);},onState:availability=>{for(const name of ['undo','redo'])wrapper.querySelector('[data-rich-command="'+name+'"]').disabled=!availability[name];}});
    const formatting=mountRichFormatting({editor,wrapper,state,listen,remember,selectRange,edit,insertHTML,addImages,safeLink:safeRichLink,safeColor:safeTextColor,colorChoices,refreshLinks:()=>refreshCitations(editor)});
    listen(editor,'beforeinput',event=>{if(['historyUndo','historyRedo'].includes(event.inputType)){event.preventDefault();if(!state.pending&&!state.composing)state.history[event.inputType==='historyUndo'?'undo':'redo']();return;}state.history.remember();});
  }
  return () => added.forEach(editor=>{mounts.get(editor)?.controller.abort();mounts.delete(editor);});
}
export function flushRichEditors(root) {
  const editors = root.matches?.('.rich-editor-input') ? [root] : Array.from(root.querySelectorAll('.rich-editor-input'));
  const pending=editors.find(editor=>mounts.get(editor)?.pending||mounts.get(editor)?.composing||mounts.get(editor)?.resize?.active);
  if(pending){const state=mounts.get(pending);state?.message(state.resize?.active?'请先松开图片缩放手柄。':'请等待输入或图片处理完成后再切换。',true);return false;}
  return true;
}
export function destroyRichEditors(root) {
  const editors=root.matches?.('.rich-editor-input')?[root]:Array.from(root.querySelectorAll('.rich-editor-input'));
  editors.forEach(editor=>{const state=mounts.get(editor);if(state){state.revision++;state.controller.abort();mounts.delete(editor);}});
}
