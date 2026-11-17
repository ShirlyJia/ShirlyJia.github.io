/** The paired Mac owns editing; public visitors can browse without an account. */
export function applyViewerMode(container,maintainer) {
  document.body.classList.toggle('board-reader',!maintainer);if(maintainer)return;
  container.querySelectorAll('input,textarea,select,[contenteditable]').forEach(el=>{
    if(el.matches('select,input[type="checkbox"]'))el.disabled=true;
    else if(el.matches('input,textarea'))el.readOnly=true;
    else {el.contentEditable='false';el.setAttribute('aria-readonly','true');}
  });
  container.querySelectorAll('[data-flow-current]').forEach(el=>el.disabled=true);
}

export function removeRetiredSession({local,session,location,history}) {
  for(const storage of [local,session])for(const key of ['topic-feishu-session-v1','topic-feishu-login-proof'])try{storage.removeItem(key);}catch{}
  if(new URLSearchParams(location.hash.slice(1)).has('feishu_code'))history.replaceState(history.state,'',location.pathname+location.search);
}
