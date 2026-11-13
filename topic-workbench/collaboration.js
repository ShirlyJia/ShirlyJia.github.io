import {collaborationConfig as config} from './collaboration-config.js';
import {richEditorMarkup,mountRichEditors,readRichEditor,richHTML,richHasContent,destroyRichEditors,flushRichEditors} from './rich-text.js?v=20261030-card-preview';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='topic-feishu-session-v1',proofKey='topic-feishu-login-proof';
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hash=async value=>base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const drafts=new Map();
export function createCollaboration({notify=()=>{},onIdentity=()=>{},onLegacyPosted=()=>{},localOwner=false}={}){
 let user=null,token='',root=null,pid='',records=[],loading=false,ready=false,poll=0,editing=null,busy=false;
 const recordDrafts=new Map(),recordWrites=new Map();
 function isOwner(){return !config.enabled||localOwner||user?.role==='owner';}
 async function api(path,options={}){
  let response;try {response=await fetch(config.origin+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...options.headers},cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw Error('协作服务暂时无法连接，内容仍保留在输入框中');}
  let data;try{data=await response.json();}catch{throw Error('协作服务返回异常，请稍后重试');}
  if(response.status===401){token='';user=null;localStorage.removeItem(key);renderAccount();onIdentity();}
  if(!response.ok)throw Object.assign(Error(data.error||'操作未完成'),{status:response.status});return data;
 }
 async function login(){
  keepDraft();const verifier=base64(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(proofKey,JSON.stringify({verifier,createdAt:Date.now()}));
  const back=new URL(location.href);back.hash='';if(pid)back.searchParams.set('project',pid);
  const url=new URL(config.origin+'/auth/feishu/start');url.searchParams.set('return_to',back.href);url.searchParams.set('challenge',await hash(verifier));location.assign(url.href);
 }
 function renderAccount(){
  const el=document.getElementById('feishuAccount');if(!el)return;
  el.innerHTML=user?'<span class="feishu-person">'+(user.avatar?'<img src="'+esc(user.avatar)+'" alt="" referrerpolicy="no-referrer">':'')+esc(user.name)+'</span><button data-feishu-logout title="退出飞书登录">退出</button>':'<button class="feishu-login" data-feishu-login>飞书登录</button>';
  el.querySelector('[data-feishu-login]')?.addEventListener('click',()=>login().catch(e=>notify(e.message)));
  el.querySelector('[data-feishu-logout]')?.addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}catch(e){notify(e.message);return;}keepDraft();token='';user=null;localStorage.removeItem(key);renderAccount();render();onIdentity();});
  document.body.classList.add('collaboration-enabled');document.body.classList.toggle('board-reader',!isOwner());
 }
 async function init(){
  if(!config.enabled)return;
  if(!document.getElementById('feishuAccount')){const el=document.createElement('div');el.id='feishuAccount';el.className='feishu-account';document.querySelector('.app-header').append(el);}
  const code=new URLSearchParams(location.hash.slice(1)).get('feishu_code');
  try {
   if(code){
    history.replaceState(null,'',location.pathname+location.search);
    let proof;try{proof=JSON.parse(sessionStorage.getItem(proofKey)||'null');}catch{}
    sessionStorage.removeItem(proofKey);
    if(!proof||Date.now()-proof.createdAt>600000)throw Error('请从当前画板重新发起飞书登录');
    const result=await api('/api/auth/exchange',{method:'POST',body:JSON.stringify({code,verifier:proof.verifier})});
    token=result.token;user=result.user;localStorage.setItem(key,JSON.stringify(result));notify('已使用 '+user.name+' 登录');
   }else{
    let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(saved?.expiresAt>Date.now()){token=saved.token;user=(await api('/api/me')).user;if(!user){token='';localStorage.removeItem(key);}}
   }
  }catch(error){token='';user=null;notify(error.message);}
  ready=true;renderAccount();onIdentity();
 }
 function keepDraft(){
  for(const record of records)if(recordDraft(record.id))commitRecord(record.id);
  const form=root?.querySelector('[data-collab-compose]');if(!form)return;
  const content=readRichEditor(form.querySelector('.rich-editor-input'));
  const draft={...content,title:form.elements.title.value,id:form.dataset.id,editing,_legacy:draftFor()?._legacy};
  drafts.set(pid,draft);try{sessionStorage.setItem('collab-draft:'+pid,JSON.stringify(draft));}catch{}
 }
 function draftFor(){if(drafts.has(pid))return drafts.get(pid);try{return JSON.parse(sessionStorage.getItem('collab-draft:'+pid)||'null');}catch{return null;}}
 function clearDraft(){drafts.delete(pid);sessionStorage.removeItem('collab-draft:'+pid);editing=null;}
 function personMarkup(actor){return '<span class="comment-identity" title="飞书账号：'+esc(actor.name)+'">'+(actor.avatar?'<img src="'+esc(actor.avatar)+'" alt="" referrerpolicy="no-referrer">':'<span class="comment-identity-dot" aria-hidden="true"></span>')+esc(actor.name)+'</span>';}
 function compose(){
  const d=draftFor()||{};editing=d.editing||null;
  const legacyUrl=!editing&&d.url?String(d.url):'',text=[d.text,legacyUrl].filter(Boolean).join('\n'),html=legacyUrl?(d.html||'<p>'+esc(d.text||'')+'</p>')+'<p>'+esc(legacyUrl)+'</p>':d.html||'';
  return '<form class="comment-composer" data-collab-compose data-id="'+esc(d.id||crypto.randomUUID())+'"><div class="inline-field">'+richEditorMarkup({value:text,html,label:'记录新信息',placeholder:'记下想法、讨论或进展…',collapsible:true})+'</div><div class="comment-compose-actions"><input name="title" aria-label="新记录标题" placeholder="标题（选填）" maxlength="120" value="'+esc(d.title||'')+'">'+(user?personMarkup(user):'')+(editing?'<button type="button" class="comment-cancel-edit" data-collab-cancel>取消修改</button>':'')+'<button class="primary" type="submit">'+(user?(editing?'保存修改':'记一条 <span aria-hidden="true">↗</span>'):'登录后记录')+'</button></div><p class="collab-error" role="alert" hidden></p></form>';
 }
 const pinIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3h6l-1 5 3 3v2H5v-2l3-3-1-5Zm3 10v5"/></svg>';
 const draftKey=id=>'collab-inline:'+user?.id+':'+id;
 function recordDraft(id){
  if(!user)return null;const key=draftKey(id);if(recordDrafts.has(key))return recordDrafts.get(key);
  try{const d=JSON.parse(sessionStorage.getItem(key)||'null');if(d?.id===id&&Number.isInteger(d.version)){recordDrafts.set(key,d);return d;}}catch{}return null;
 }
 function storeRecordDraft(id,draft){const key=draftKey(id);if(draft)recordDrafts.set(key,draft);else recordDrafts.delete(key);try{if(draft)sessionStorage.setItem(key,JSON.stringify(draft));else sessionStorage.removeItem(key);}catch{}}
 function editable(record){return user&&(user.id===record.actor.id||user.role==='owner');}
 function stageRecord(id,patch){
  const record=records.find(row=>row.id===id);if(!record||!editable(record))return;
  const d=recordDraft(id)||{id,project:pid,title:record.title,body:record.body,html:record.html,version:record.version,revision:0};
  if(Object.entries(patch).every(([key,value])=>d[key]===value))return;
  storeRecordDraft(id,{...d,...patch,revision:d.revision+1});setRecordStatus(id,'未保存');
 }
 function recordElement(id){return [...(root?.querySelectorAll('[data-cloud-record]')||[])].find(el=>el.dataset.cloudRecord===id);}
 function setRecordStatus(id,message,error=false){
  const element=recordElement(id)?.querySelector('[data-record-save]');if(!element)return;
  element.hidden=!message;element.classList.toggle('is-error',error);element.textContent=message;
  if(error){for(const [label,handler] of [['重试',()=>commitRecord(id)],['放弃修改',()=>{storeRecordDraft(id,null);refresh();}]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=handler;element.append(button);}}
 }
 function attribution(record){return personMarkup(record.actor)+(record.version>1?'<span class="comment-edited" title="'+esc(record.updatedBy.name+' · '+date(record.updatedAt)+' 修改')+'">已编辑</span>':'');}
 async function commitRecord(id){
  const key=draftKey(id),actor=user?.id;if(recordWrites.has(key))return recordWrites.get(key);
  if(!recordDraft(id))return true;
  const pending=(async()=>{
   try{
    while(user?.id===actor){
     const sent=recordDraft(id);if(!sent)return true;setRecordStatus(id,'保存中…');
     const {record}=await api('/api/records/'+id,{method:'PATCH',body:JSON.stringify({version:sent.version,title:sent.title,body:sent.body,html:sent.html})});
     if(user?.id!==actor)return false;
     const index=records.findIndex(row=>row.id===id);if(index>=0)records[index]=record;
     const latest=recordDraft(id);
     if(latest?.revision===sent.revision){storeRecordDraft(id,null);setRecordStatus(id,'');}
     else if(latest)storeRecordDraft(id,{...latest,version:record.version});
     const label=recordElement(id)?.querySelector('[data-record-attribution]');if(label)label.innerHTML=attribution(record);
    }
    return false;
   }catch(error){setRecordStatus(id,error.message,true);notify('记录尚未保存，修改已保留');return false;}
  })();
  recordWrites.set(key,pending);try{return await pending;}finally{recordWrites.delete(key);}
 }
 function recordMarkup(record){
  const mine=editable(record),d=mine?recordDraft(record.id):null,r=d?{...record,...d}:record;
  const title=mine?'<input class="comment-title" data-record-title="'+esc(r.id)+'" aria-label="记录标题" title="点击修改标题" placeholder="随手记录" maxlength="120" value="'+esc(r.title)+'">':'<span class="comment-title comment-title-readonly">'+esc(r.title||'随手记录')+'</span>';
  const avatar='<span class="comment-record-mark" aria-hidden="true">'+(r.actor.avatar?'<img src="'+esc(r.actor.avatar)+'" alt="" referrerpolicy="no-referrer">':esc((r.actor.name||'记').slice(0,1)))+'</span>';
  const actions=mine?'<div class="comment-actions cloud-comment-actions">'+(user.role==='owner'?'<button type="button" class="comment-pin" data-record-pin="'+esc(r.id)+'" aria-label="'+(r.pinned?'取消置顶':'置顶这条记录')+'" title="'+(r.pinned?'取消置顶':'置顶')+'" aria-pressed="'+Boolean(r.pinned)+'">'+pinIcon+(r.pinned?'<span>置顶</span>':'')+'</button>':'')+'<details class="collab-record-menu"><summary aria-label="管理此记录">···</summary><div><button type="button" data-record-history="'+esc(r.id)+'">修改历史</button><button type="button" data-record-delete="'+esc(r.id)+'">删除</button></div></details></div>':r.pinned?'<span class="comment-pinned-label">置顶</span>':'';
  const content=mine?richEditorMarkup({value:r.body,html:r.html,label:'记录内容',placeholder:'记录内容',collapsible:true,attrs:'data-cloud-body="'+esc(r.id)+'"'}):'<div class="rich-content">'+richHTML(r.html,r.body)+'</div>';
  return '<article class="comment-entry cloud-comment'+(r.pinned?' is-pinned':'')+'" data-cloud-record="'+esc(r.id)+'"><header>'+avatar+'<div class="comment-meta">'+title+'<time datetime="'+esc(r.createdAt)+'">'+date(r.createdAt)+'</time></div>'+actions+'</header><div class="inline-field">'+content+(r.url?'<a class="collab-material" target="_blank" rel="noopener noreferrer" href="'+esc(r.url)+'">↗ '+esc(r.url)+'</a>':'')+'</div><footer data-record-attribution>'+attribution(record)+'</footer><p class="comment-record-save" data-record-save role="status"'+(d?'':' hidden')+'>'+(d?'有未保存的修改':'')+'</p><div data-record-history-body hidden></div></article>';
 }
 function render(){
  if(!root?.isConnected)return;destroyRichEditors(root);
  root.innerHTML=compose()+'<div class="comment-entries" aria-label="项目留言">'+records.map(recordMarkup).join('')+'</div>'+(loading?'<p class="collab-loading">正在读取…</p>':'');
  mountRichEditors(root,{onError:notify,onChange:(value,el)=>{if(el.dataset.cloudBody)stageRecord(el.dataset.cloudBody,{body:value.text,html:value.html});else keepDraft();},onCommit:el=>{if(el.dataset.cloudBody){const value=readRichEditor(el);stageRecord(el.dataset.cloudBody,{body:value.text,html:value.html});commitRecord(el.dataset.cloudBody);}else keepDraft();return true;}});
  const form=root.querySelector('form');form.addEventListener('input',keepDraft);form.addEventListener('change',keepDraft);form.addEventListener('submit',submit);
  root.querySelector('[data-collab-cancel]')?.addEventListener('click',()=>{clearDraft();render();});
  root.querySelectorAll('[data-record-title]').forEach(input=>{input.addEventListener('input',()=>stageRecord(input.dataset.recordTitle,{title:input.value}));input.addEventListener('change',()=>commitRecord(input.dataset.recordTitle));input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});});
  root.querySelectorAll('[data-record-delete]').forEach(b=>b.onclick=()=>{const id=b.dataset.recordDelete,menu=b.parentElement;menu.innerHTML='<span>删除这条记录？</span><button type="button" data-confirm-delete>删除</button>';menu.querySelector('button').onclick=()=>changeRecord(id,'DELETE');});
  root.querySelectorAll('[data-record-pin]').forEach(b=>b.onclick=()=>changeRecord(b.dataset.recordPin,'PATCH',{pinned:!records.find(r=>r.id===b.dataset.recordPin).pinned}));
  root.querySelectorAll('[data-record-history]').forEach(b=>b.onclick=async()=>{try{if(!await commitRecord(b.dataset.recordHistory))return;const data=await api('/api/records/'+b.dataset.recordHistory+'/history');const box=b.closest('article').querySelector('[data-record-history-body]');box.hidden=!box.hidden;box.innerHTML=data.history.map(h=>'<div class="collab-history-row"><strong>'+esc(h.title||'留言')+'</strong><p>'+esc(h.body)+'</p><small>'+esc(h.changedBy)+' · <time>'+date(h.changedAt)+'</time></small></div>').join('');}catch(e){notify(e.message);}});
 }
 async function submit(e){
  e.preventDefault();if(busy||!flushRichEditors(root))return;keepDraft();if(!user){try{await login();}catch(error){notify(error.message);}return;}const d=draftFor();if(!richHasContent({text:d.text,html:d.html}))return;
  const project=pid,form=e.currentTarget,button=form.querySelector('[type="submit"]'),error=form.querySelector('.collab-error');busy=true;button.disabled=true;error.hidden=true;
  try {
   const payload={id:d.id,title:d.title,body:d.text,html:d.html,...(editing?{version:editing.version}:{kind:'comment'})};
   await api(editing?'/api/records/'+editing.id:'/api/projects/'+encodeURIComponent(project)+'/records',{method:editing?'PATCH':'POST',body:JSON.stringify(payload)});
   drafts.delete(project);sessionStorage.removeItem('collab-draft:'+project);if(d._legacy)onLegacyPosted(project,d._legacy);
   if(pid===project){editing=null;form.elements.title.value='';form.dataset.id=crypto.randomUUID();form.querySelector('.rich-editor-input').innerHTML='';await refresh();}notify('留言已保存');
  }catch(e){error.textContent=e.message;error.hidden=false;}finally{busy=false;button.disabled=false;}
 }
 async function changeRecord(id,method,extra={}){try{keepDraft();if(!await commitRecord(id))return;await api('/api/records/'+id,{method,body:JSON.stringify({version:records.find(r=>r.id===id).version,...extra})});await refresh();}catch(e){notify(e.message);}}
 async function refresh(){
  const project=pid;try{const data=await api('/api/projects/'+encodeURIComponent(project)+'/records');if(project!==pid)return;keepDraft();records=data.records;loading=false;render();}catch(e){if(project!==pid)return;loading=false;if(root?.isConnected){root.querySelector('.collab-loading')?.remove();root.querySelector('[data-collab-load-error]')?.remove();const error=document.createElement('p');error.className='collab-error';error.dataset.collabLoadError='';error.append(document.createTextNode(e.message+' '));const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>refresh();error.append(retry);root.append(error);}}
 }
 function mount(container,project,{legacyDraft}={}){
  if(!config.enabled)return;keepDraft();clearInterval(poll);root=container;pid=project;records=[];editing=null;loading=true;if(isOwner()&&!draftFor()&&legacyDraft&&richHasContent(legacyDraft))drafts.set(pid,{...legacyDraft,_legacy:legacyDraft});render();refresh();
  poll=setInterval(()=>{if(root?.isConnected&&!document.hidden&&!root.contains(document.activeElement)&&!busy&&!recordWrites.size)refresh();},30000);
 }
 function applyReadonly(container){
  document.body.classList.toggle('board-reader',!isOwner());if(isOwner())return;
  container.querySelectorAll('input,textarea,select,[contenteditable]').forEach(el=>{if(el.closest('.collaboration'))return;if(el.matches('select,input[type="checkbox"]'))el.disabled=true;else if(el.matches('input,textarea'))el.readOnly=true;else {el.contentEditable='false';el.setAttribute('aria-readonly','true');}});
  container.querySelectorAll('[data-flow-current]').forEach(el=>el.disabled=true);
 }
 function markup(){return config.enabled?'<div class="collaboration" data-collaboration></div>':'';}
 async function listRecords(project){return config.enabled?(await api('/api/projects/'+encodeURIComponent(project)+'/records')).records:[];}
 return {init,isOwner,markup,mount,applyReadonly,keepDraft,login,listRecords,get user(){return user;},get enabled(){return config.enabled;},get ready(){return ready;}};
}
