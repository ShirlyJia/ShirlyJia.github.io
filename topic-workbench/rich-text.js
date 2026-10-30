/** Small shared editor. Rich HTML is optional; plain text stays available to cards/search. */
import {safeImageWidth,mountImageResize} from './rich-image-resize.js';
import {colorChoices} from './color-presets.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const supportedImages = /^image\/(png|jpeg|webp|gif)$/i;
const imageData = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const MAX_IMAGE_DATA = 850000;
const mounts = new WeakMap();
const defaultTextColor = '#37352f';
let activeColorPopup = null;
const allowTags = new Set('P DIV BR STRONG B EM I U S DEL H1 H2 H3 UL OL LI BLOCKQUOTE PRE CODE A IMG HR TABLE THEAD TBODY TFOOT TR TH TD FIGURE FIGCAPTION'.split(' '));
const dropTags = new Set('SCRIPT STYLE IFRAME FRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON TEXTAREA SELECT OPTION META LINK BASE AUDIO VIDEO SOURCE TEMPLATE NOSCRIPT'.split(' '));
const blockTags = new Set('P DIV H1 H2 H3 LI BLOCKQUOTE PRE TABLE TR FIGURE FIGCAPTION'.split(' '));

export function safeRichLink(value) {
  try { const url = new URL(String(value).trim()); return ['https:','http:','mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
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
function nodeTextColor(node) { return safeTextColor(node.style?.color || (node.tagName==='FONT'?node.getAttribute('color'):'')); }
function copyTextColor(node, target) { const color=nodeTextColor(node);if(color)target.style.color=color; }
function plainHTML(value) { return String(value ?? '').split(/\r?\n/).map(line => `<div>${esc(line) || '<br>'}</div>`).join(''); }

/** Never interpolate saved/pasted HTML directly. Rebuild only supported elements. */
export function richHTML(html, plain = '') {
  if (!html || typeof html !== 'string' || typeof document === 'undefined') return plainHTML(plain);
  const source = document.createElement('template'); source.innerHTML = html;
  const output = document.createElement('div');
  function copy(node, parent) {
    if (node.nodeType === 3) { parent.append(document.createTextNode(node.nodeValue)); return; }
    if (node.nodeType !== 1 || dropTags.has(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const src = safeRichImage(node.getAttribute('src'));
      if (!src) return;
      const img = document.createElement('img'); img.src = src; img.alt = node.getAttribute('alt') || '图片'; img.draggable = false;
      const width=safeImageWidth(node.getAttribute('width'));if(width!==null)img.setAttribute('width',width);
      parent.append(img); return;
    }
    if (!allowTags.has(node.tagName)) {
      let next = parent;
      const color=nodeTextColor(node);
      if(color){const span=document.createElement('span');span.style.color=color;next.append(span);next=span;}
      if (node.tagName === 'SPAN') {
        const style = node.getAttribute('style') || '';
        for (const [pattern, tag] of [[/font-weight\s*:\s*(bold|[6-9]00)/i,'strong'], [/font-style\s*:\s*italic/i,'em']]) {
          if (pattern.test(style)) { const element = document.createElement(tag); next.append(element); next = element; }
        }
      }
      for (const child of node.childNodes) copy(child, next);
      return;
    }
    if (node.tagName === 'A') {
      const href = safeRichLink(node.getAttribute('href'));
      if (!href) { for (const child of node.childNodes) copy(child, parent); return; }
      const link = document.createElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      copyTextColor(node,link);
      parent.append(link); for (const child of node.childNodes) copy(child, link); return;
    }
    const element = document.createElement(node.tagName.toLowerCase());
    copyTextColor(node,element);
    parent.append(element); for (const child of node.childNodes) copy(child, element);
  }
  for (const child of source.content.childNodes) copy(child, output);
  return output.innerHTML;
}
function plainFromHTML(html) {
  const holder = document.createElement('div'); holder.innerHTML = html;
  function walk(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'IMG') return '[图片]';
    if (node.tagName === 'BR') return '\n';
    const body = Array.from(node.childNodes).map(walk).join('');
    return blockTags.has(node.tagName) ? body + '\n' : body;
  }
  return Array.from(holder.childNodes).map(walk).join('').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').replace(/\n+$/,'');
}
function accompanyingContent(html, plain) {
  if (!html) return plain ? plainHTML(plain) : '';
  const content=document.createElement('template');content.innerHTML=richHTML(html);
  content.content.querySelectorAll('img').forEach(image=>image.remove());
  return content.innerHTML;
}
export function readRichEditor(editor) { const html = richHTML(editor.innerHTML); return {text:plainFromHTML(html), html}; }
export function setRichEditor(editor, {text = '', html = ''} = {}) {
  if (!editor) return;
  const mounted = mounts.get(editor);
  if (mounted) { mounted.closeColors?.();mounted.resize?.cancel();mounted.revision++; mounted.range = null; mounted.image = null; }
  editor.innerHTML = richHTML(html, text); updateEmpty(editor); updateImageTools(editor);
}
export function richHasContent({text = '', html = ''} = {}) { return Boolean(text.trim() || /<img\b/i.test(html)); }
function updateEmpty(editor) { editor.dataset.empty = String(!editor.textContent.trim() && !editor.querySelector('img,hr')); }
const tool = (command, title, label, extra = '') => `<button type="button" data-rich-command="${command}" title="${title}" aria-label="${title}" ${extra}>${label}</button>`;
export function richEditorMarkup({value = '', html = '', label = '内容', placeholder = '输入内容，可直接粘贴图片', attrs = ''} = {}) {
  return `<div class="rich-editor"><div class="rich-toolbar" role="toolbar" aria-label="${esc(label)}格式">${tool('bold','加粗','<b>B</b>')}${tool('italic','斜体','<i>I</i>')}${tool('heading','小标题','H')}${tool('foreColor','文字颜色','<span class="rich-color-letter" aria-hidden="true">A</span><span class="rich-color-chevron" aria-hidden="true">⌄</span>','aria-haspopup="menu" aria-expanded="false"')}${tool('insertUnorderedList','项目符号','☷')}${tool('insertOrderedList','编号列表','1.')}${tool('link','插入链接','链接')}${tool('image','插入图片','图片')}${tool('removeFormat','清除格式','T×')}<span class="rich-paste-hint">可粘贴图片</span></div><div class="rich-editor-input rich-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}" data-placeholder="${esc(placeholder)}" spellcheck="false" ${attrs}>${richHTML(html, value)}</div><div class="rich-image-tools" hidden><label>宽度 <input type="number" min="24" max="4096" step="1" data-rich-image-width aria-label="图片宽度"> px</label><button type="button" data-rich-command="resetImageSize">恢复原尺寸</button><button type="button" data-rich-command="removeImage">删除图片</button></div><input class="rich-image-picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden><div class="rich-link-popover" hidden><label>链接地址<input type="url" placeholder="https://…" aria-label="链接地址"></label><button type="button" data-rich-link-save>应用</button><button type="button" data-rich-link-cancel>取消</button></div><p class="rich-editor-message" role="status" hidden></p></div>`;
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
function notify(editor) { editor.dispatchEvent(new Event('input', {bubbles:true})); }
function edit(editor, operation) { const before=mounts.get(editor)?.inputs;operation();if(mounts.get(editor)?.inputs===before)notify(editor); }
function insertHTML(editor, html) {
  if (document.execCommand('insertHTML', false, html)) return;
  const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.startContainer)) return;
  const fragment = range.createContextualFragment(html), end = fragment.lastChild;
  range.deleteContents(); range.insertNode(fragment);
  if (end) { range.setStartAfter(end); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
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
export function mountRichEditors(root, {onChange, onError} = {}) {
  const editors = root.matches?.('.rich-editor-input') ? [root] : Array.from(root.querySelectorAll('.rich-editor-input'));
  const added = [];
  for (const editor of editors) {
    if (mounts.has(editor)) continue;
    const wrapper = editor.closest('.rich-editor'), controller = new AbortController();
    const state = {range:null, image:null, pending:0, revision:0, onError, controller, composing:false, inputs:0}; mounts.set(editor,state); added.push(editor);
    const listen = (target,event,fn,options={}) => target.addEventListener(event,fn,{...options,signal:controller.signal});
    const message = (text, error = false) => { const node = wrapper.querySelector('.rich-editor-message'); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error); if (error) onError?.(text,editor); };
    state.message = message;
    state.resize=mountImageResize(editor,{getImage:()=>state.image,notify:()=>notify(editor),message,signal:controller.signal});
    const colorTrigger=wrapper.querySelector('[data-rich-command="foreColor"]');
    const remember = () => {
      const range = editorRange(editor);if(range)state.range=range;
      if(range&&colorTrigger){const color=safeTextColor(document.queryCommandValue('foreColor'))||defaultTextColor;colorTrigger.style.setProperty('--rich-text-color',color);}
    };
    const closeColors=()=>{
      const popup=state.colorPopup;if(!popup)return;
      state.colorPopup=null;popup.controller.abort();popup.menu.remove();wrapper.classList.remove('rich-color-open');colorTrigger.setAttribute('aria-expanded','false');
      if(activeColorPopup===closeColors)activeColorPopup=null;
    };
    state.closeColors=closeColors;controller.signal.addEventListener('abort',closeColors,{once:true});
    const openColors=()=>{
      if(state.colorPopup){closeColors();selectRange(editor,state.range);return;}
      activeColorPopup?.();remember();activeColorPopup=closeColors;
      const menu=document.createElement('div'),popupController=new AbortController();
      menu.className='rich-color-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','文字颜色');
      const choices=[{name:'默认颜色',value:defaultTextColor},...colorChoices('ink')];
      const selected=safeTextColor(document.queryCommandValue('foreColor'))||defaultTextColor;
      menu.innerHTML=choices.map(c=>'<button type="button" role="menuitemradio" aria-checked="'+(selected===c.value)+'" data-rich-color="'+c.value+'"><span class="rich-color-sample" style="color:'+c.value+'" aria-hidden="true">A</span><span>'+esc(c.name)+'</span><span class="rich-color-check" aria-hidden="true">✓</span></button>').join('');
      if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');
      (wrapper.closest('dialog[open]')||document.body).append(menu);state.colorPopup={menu,controller:popupController};
      wrapper.classList.add('rich-color-open');colorTrigger.setAttribute('aria-expanded','true');
      if(typeof menu.showPopover==='function')menu.showPopover();
      const position=()=>{
        if(!editor.isConnected){closeColors();return;}
        const r=colorTrigger.getBoundingClientRect(),h=menu.offsetHeight,w=menu.offsetWidth;
        menu.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';
        menu.style.top=Math.max(8,Math.min(r.bottom+6+h<=innerHeight-8?r.bottom+6:r.top-h-6,innerHeight-h-8))+'px';
      };
      position();
      const popupListen=(target,event,fn,options={})=>target.addEventListener(event,fn,{...options,signal:popupController.signal});
      popupListen(menu,'mousedown',event=>event.preventDefault());
      popupListen(menu,'click',event=>{
        const choice=event.target.closest('[data-rich-color]');if(!choice)return;
        event.preventDefault();event.stopPropagation();const color=safeTextColor(choice.dataset.richColor);if(!color)return;
        closeColors();selectRange(editor,state.range);edit(editor,()=>document.execCommand('foreColor',false,color));remember();
      });
      popupListen(menu,'keydown',event=>{
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();closeColors();selectRange(editor,state.range);return;}
        if(event.key==='Tab'){event.preventDefault();closeColors();selectRange(editor,state.range);return;}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        event.preventDefault();const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;
        buttons[next].focus({preventScroll:true});
      });
      popupListen(document,'pointerdown',event=>{if(!menu.contains(event.target)&&!colorTrigger.contains(event.target))closeColors();},true);
      popupListen(window,'resize',position);popupListen(document,'scroll',position,true);
      (menu.querySelector('[aria-checked="true"]')||menu.querySelector('button')).focus({preventScroll:true});
    };
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
        selectRange(editor, range); edit(editor,()=>insertHTML(editor, markup.join(''))); remember();
      } catch(error) { if (editor.isConnected) message(error.message || '图片插入失败，请重试。',true); }
      finally { state.pending=0; delete editor.dataset.richPending; }
    };
    listen(editor,'input',()=>{state.inputs++;updateEmpty(editor);updateImageTools(editor);remember();onChange?.(readRichEditor(editor),editor);});
    listen(editor,'compositionstart',()=>state.composing=true); listen(editor,'compositionend',()=>{state.composing=false;remember();const before=state.inputs;queueMicrotask(()=>{if(editor.isConnected&&state.inputs===before)notify(editor);});});
    listen(editor,'keyup',remember); listen(editor,'mouseup',remember); listen(editor,'focus',remember);
    listen(editor,'click',event=>{state.image=event.target.tagName==='IMG'?event.target:null; updateImageTools(editor);});
    listen(document,'pointerdown',event=>{if(state.image&&!wrapper.contains(event.target)&&!state.resize.active){state.image=null;updateImageTools(editor);}});
    listen(editor,'keydown',event=>{
      event.stopPropagation();
      if (!state.composing && state.image && ['Backspace','Delete'].includes(event.key)) {
        event.preventDefault(); const range=document.createRange();range.selectNode(state.image);selectRange(editor,range);edit(editor,()=>document.execCommand('delete'));state.image=null;updateImageTools(editor);
      }
    });
    listen(editor,'paste',event=>{
      const clipboard=event.clipboardData; if(!clipboard)return;
      const files=Array.from(clipboard.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
      const html=clipboard.getData('text/html'),plain=clipboard.getData('text/plain');
      if(files.length){event.preventDefault();addImages(files,accompanyingContent(html,plain));return;}
      if(!html&&!plain)return;
      event.preventDefault();remember();selectRange(editor,state.range);edit(editor,()=>insertHTML(editor,html?richHTML(html):plainHTML(plain)));remember();
      if (html && /<img\b/i.test(html) && !/<img\b/i.test(richHTML(html))) message('文字已粘贴。网页图片请复制图片本身，或用「图片」上传。',true);
    });
    listen(editor,'dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();wrapper.classList.add('rich-dragging');}});
    listen(editor,'dragleave',()=>wrapper.classList.remove('rich-dragging'));
    listen(editor,'drop',event=>{wrapper.classList.remove('rich-dragging');if(!event.dataTransfer)return;const files=Array.from(event.dataTransfer.files);event.preventDefault();
      const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(range&&editor.contains(range.startContainer)){selectRange(editor,range);state.range=range.cloneRange();}
      const html=event.dataTransfer.getData('text/html'),plain=event.dataTransfer.getData('text/plain');
      if(files.length){addImages(files,accompanyingContent(html,plain));return;}
      if(html||plain){selectRange(editor,state.range);edit(editor,()=>insertHTML(editor,html?richHTML(html):plainHTML(plain)));remember();}
      if(html&&/<img\b/i.test(html)&&!/<img\b/i.test(richHTML(html)))message('文字已插入。网页图片请复制图片本身，或用「图片」上传。',true);
    });
    listen(wrapper.querySelector('.rich-toolbar'),'mousedown',event=>{if(event.target.closest('button')){remember();event.preventDefault();}});
    listen(wrapper,'click',event=>{
      const command=event.target.closest('[data-rich-command]')?.dataset.richCommand;if(!command)return;event.preventDefault();event.stopPropagation();
      if(command==='foreColor'){openColors();return;}
      if(command==='image'){remember();wrapper.querySelector('.rich-image-picker').click();return;}
      if(command==='link'){remember();const popover=wrapper.querySelector('.rich-link-popover');popover.hidden=false;popover.querySelector('input').value='';popover.querySelector('input').focus();return;}
      if(command==='removeImage'){if(state.image){const range=document.createRange();range.selectNode(state.image);selectRange(editor,range);edit(editor,()=>document.execCommand('delete'));state.image=null;updateImageTools(editor);}return;}
      if(command==='resetImageSize'){state.resize.reset();return;}
      selectRange(editor,state.range);
      edit(editor,()=>{if(command==='heading')document.execCommand('formatBlock',false,'h3');else if(command==='removeFormat'){document.execCommand('removeFormat',false,null);document.execCommand('formatBlock',false,'p');}else document.execCommand(command,false,null);});
      remember();
    });
    listen(wrapper.querySelector('.rich-image-picker'),'change',event=>{addImages(event.target.files);event.target.value='';});
    const applyLink=()=>{
      const popover=wrapper.querySelector('.rich-link-popover'),url=safeRichLink(popover.querySelector('input').value);if(!url){message('请输入有效的 http、https 或邮件链接。',true);return;}
      selectRange(editor,state.range);
      edit(editor,()=>{if(window.getSelection()?.isCollapsed)insertHTML(editor,`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);else document.execCommand('createLink',false,url);});
      popover.hidden=true;message('');remember();
    };
    listen(wrapper.querySelector('[data-rich-link-save]'),'click',applyLink);
    listen(wrapper.querySelector('[data-rich-link-cancel]'),'click',()=>{wrapper.querySelector('.rich-link-popover').hidden=true;selectRange(editor,state.range);});
    listen(wrapper.querySelector('.rich-link-popover input'),'keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();applyLink();}if(event.key==='Escape'){wrapper.querySelector('.rich-link-popover').hidden=true;selectRange(editor,state.range);}});
    updateEmpty(editor);
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
