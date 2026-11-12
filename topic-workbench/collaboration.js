import {collaborationConfig as config} from './collaboration-config.js';
import {richEditorMarkup,mountRichEditors,readRichEditor,richHTML,richHasContent,destroyRichEditors,flushRichEditors} from './rich-text.js?v=20261030-card-preview';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='topic-feishu-session-v1',proofKey='topic-feishu-login-proof';
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hash=async value=>base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const date=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const types={comment:'留言',supplement:'内容补充',material:'资料'};
const drafts=new Map();
export function createCollaboration({notify=()=>{},onIdentity=()=>{},localOwner=false}={}){
 let user=null,token='',root=null,pid='',records=[],loading=false,ready=false,poll=0,editing=null,busy=false;
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
  const form=root?.querySelector('[data-collab-compose]');if(!form)return;
  const content=readRichEditor(form.querySelector('.rich-editor-input'));
  const draft={...content,title:form.elements.title.value,kind:form.elements.kind.value,url:form.elements.url.value,id:form.dataset.id,editing};
  drafts.set(pid,draft);try{sessionStorage.setItem('collab-draft:'+pid,JSON.stringify(draft));}catch{}
 }
 function draftFor(){if(drafts.has(pid))return drafts.get(pid);try{return JSON.parse(sessionStorage.getItem('collab-draft:'+pid)||'null');}catch{return null;}}
 function clearDraft(){drafts.delete(pid);sessionStorage.removeItem('collab-draft:'+pid);editing=null;}
 function compose(){
  if(!user)return '<div class="collab-signin"><span>登录后留言、补充内容和资料</span><button data-collab-login>飞书登录</button></div>';
  const d=draftFor()||{};editing=d.editing||null;
  return '<form data-collab-compose data-id="'+esc(d.id||crypto.randomUUID())+'"><div class="collab-compose-head"><select name="kind" aria-label="记录类型">'+Object.entries(types).map(([v,l])=>'<option value="'+v+'"'+(d.kind===v?' selected':'')+'>'+l+'</option>').join('')+'<input name="title" aria-label="记录标题" placeholder="标题（选填）" maxlength="120" value="'+esc(d.title||'')+'"></div>'+richEditorMarkup({value:d.text||'',html:d.html||'',label:'协作记录',placeholder:'记录进展、补充问题与背景，也可直接粘贴图片…',collapsible:true})+'<label class="collab-url"'+(d.kind==='material'?'':' hidden')+'>资料链接<input name="url" type="url" placeholder="粘贴飞书文档或其他资料链接" value="'+esc(d.url||'')+'"></label><div class="collab-compose-footer"><span>以 '+esc(user.name)+' 的身份记录</span>'+(editing?'<button type="button" data-collab-cancel>取消修改</button>':'')+'<button class="primary" type="submit">'+(editing?'保存修改':'发布记录')+'</button></div><p class="collab-error" role="alert" hidden></p></form>';
 }
 function recordMarkup(r){
  const mine=user&&(user.id===r.actor.id||user.role==='owner');
  return '<article class="collab-record'+(r.pinned?' pinned':'')+'" data-cloud-record="'+esc(r.id)+'"><header><span class="collab-kind">'+(r.pinned?'置顶 · ':'')+types[r.kind]+'</span><strong>'+esc(r.title||'')+'</strong>'+(mine?'<details class="collab-record-menu"><summary aria-label="管理此记录">···</summary><div><button data-record-edit="'+esc(r.id)+'">修改</button>'+(user.role==='owner'?'<button data-record-pin="'+esc(r.id)+'">'+(r.pinned?'取消置顶':'置顶')+'</button>':'')+'<button data-record-history="'+esc(r.id)+'">修改历史</button><button data-record-delete="'+esc(r.id)+'">删除</button></div></details>':'')+'</header><div class="rich-content">'+richHTML(r.html,r.body)+'</div>'+(r.url?'<a class="collab-material" target="_blank" rel="noopener noreferrer" href="'+esc(r.url)+'">↗ '+esc(r.url)+'</a>':'')+'<footer><span class="collab-actor">'+(r.actor.avatar?'<img src="'+esc(r.actor.avatar)+'" alt="" referrerpolicy="no-referrer">':'')+esc(r.actor.name)+'</span><time datetime="'+esc(r.createdAt)+'">'+date(r.createdAt)+'</time>'+(r.version>1?'<span>· '+esc(r.updatedBy.name)+' 更新于 <time datetime="'+esc(r.updatedAt)+'">'+date(r.updatedAt)+'</time></span>':'')+'</footer><div data-record-history-body hidden></div></article>';
 }
 function render(){
  if(!root?.isConnected)return;destroyRichEditors(root);
  root.innerHTML='<div class="collab-heading"><span>团队记录</span><small>'+records.length+'</small><button data-collab-refresh title="刷新团队记录">刷新</button></div>'+compose()+'<div class="collab-records">'+records.map(recordMarkup).join('')+'</div>'+(loading?'<p class="collab-loading">正在读取…</p>':'');
  mountRichEditors(root,{onError:notify,onChange:keepDraft,onCommit:()=>{keepDraft();return true;}});
  root.querySelector('[data-collab-login]')?.addEventListener('click',()=>login().catch(e=>notify(e.message)));
  root.querySelector('[data-collab-refresh]')?.addEventListener('click',()=>refresh(true));
  const form=root.querySelector('form');if(form){form.addEventListener('input',keepDraft);form.addEventListener('change',()=>{form.querySelector('.collab-url').hidden=form.elements.kind.value!=='material';keepDraft();});form.addEventListener('submit',submit);}
  root.querySelector('[data-collab-cancel]')?.addEventListener('click',()=>{clearDraft();render();});
  root.querySelectorAll('[data-record-edit]').forEach(b=>b.onclick=()=>{const r=records.find(r=>r.id===b.dataset.recordEdit);keepDraft();drafts.set(pid,{id:r.id,title:r.title,text:r.body,html:r.html,kind:r.kind,url:r.url,editing:{id:r.id,version:r.version}});render();root.querySelector('[data-collab-compose]').scrollIntoView({block:'nearest',behavior:'smooth'});});
  root.querySelectorAll('[data-record-delete]').forEach(b=>b.onclick=()=>{const id=b.dataset.recordDelete,menu=b.parentElement;menu.innerHTML='<span>删除这条记录？</span><button data-confirm-delete>删除</button>';menu.querySelector('button').onclick=()=>changeRecord(id,'DELETE');});
  root.querySelectorAll('[data-record-pin]').forEach(b=>b.onclick=()=>changeRecord(b.dataset.recordPin,'PATCH',{pinned:!records.find(r=>r.id===b.dataset.recordPin).pinned}));
  root.querySelectorAll('[data-record-history]').forEach(b=>b.onclick=async()=>{try{const data=await api('/api/records/'+b.dataset.recordHistory+'/history');const box=b.closest('article').querySelector('[data-record-history-body]');box.hidden=!box.hidden;box.innerHTML=data.history.map(h=>'<div class="collab-history-row"><strong>'+esc(h.title||types[h.kind])+'</strong><p>'+esc(h.body)+'</p><small>'+esc(h.changedBy)+' · <time>'+date(h.changedAt)+'</time></small></div>').join('');}catch(e){notify(e.message);}});
 }
 async function submit(e){
  e.preventDefault();if(busy||!flushRichEditors(root))return;keepDraft();const d=draftFor();if(!richHasContent({text:d.text,html:d.html}))return;
  const project=pid,form=e.currentTarget,button=form.querySelector('[type="submit"]'),error=form.querySelector('.collab-error');busy=true;button.disabled=true;error.hidden=true;
  try {
   const payload={id:d.id,title:d.title,body:d.text,html:d.html,kind:d.kind,url:d.url,...(editing?{version:editing.version}:{})};
   await api(editing?'/api/records/'+editing.id:'/api/projects/'+encodeURIComponent(project)+'/records',{method:editing?'PATCH':'POST',body:JSON.stringify(payload)});
   drafts.delete(project);sessionStorage.removeItem('collab-draft:'+project);
   if(pid===project){editing=null;form.elements.title.value='';form.elements.url.value='';form.elements.kind.value='comment';form.dataset.id=crypto.randomUUID();form.querySelector('.rich-editor-input').innerHTML='';await refresh();}notify('已保存到团队记录');
  }catch(e){error.textContent=e.message;error.hidden=false;}finally{busy=false;button.disabled=false;}
 }
 async function changeRecord(id,method,extra={}){try{keepDraft();await api('/api/records/'+id,{method,body:JSON.stringify({version:records.find(r=>r.id===id).version,...extra})});await refresh();}catch(e){notify(e.message);}}
 async function refresh(manual=false){
  const project=pid;try{const data=await api('/api/projects/'+encodeURIComponent(project)+'/records');if(project!==pid)return;keepDraft();records=data.records;loading=false;render();if(manual)notify('团队记录已更新');}catch(e){loading=false;if(manual)notify(e.message);else if(root?.isConnected){root.querySelector('.collab-loading')?.remove();const error=document.createElement('p');error.className='collab-error';error.textContent=e.message;root.append(error);}}
 }
 function mount(container,project){
  if(!config.enabled)return;keepDraft();clearInterval(poll);root=container;pid=project;records=[];editing=null;loading=true;render();refresh();
  poll=setInterval(()=>{if(root?.isConnected&&!document.hidden&&!root.contains(document.activeElement)&&!busy)refresh();},30000);
 }
 function applyReadonly(container){
  document.body.classList.toggle('board-reader',!isOwner());if(isOwner())return;
  container.querySelectorAll('input,textarea,select,[contenteditable]').forEach(el=>{if(el.closest('.collaboration'))return;if(el.matches('select,input[type="checkbox"]'))el.disabled=true;else if(el.matches('input,textarea'))el.readOnly=true;else {el.contentEditable='false';el.setAttribute('aria-readonly','true');}});
  container.querySelectorAll('[data-flow-current]').forEach(el=>el.disabled=true);
 }
 function markup(){return config.enabled?'<div class="collaboration" data-collaboration></div>':'';}
 return {init,isOwner,markup,mount,applyReadonly,keepDraft,login,get user(){return user;},get enabled(){return config.enabled;},get ready(){return ready;}};
}
