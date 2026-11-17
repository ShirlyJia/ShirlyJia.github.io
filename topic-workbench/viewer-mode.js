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

/** Recover unsent text as a draft only; never turn it into a submitted record. */
export function recoverCommentDrafts(projects,session) {
  for(const p of projects){
    let draft;try{draft=JSON.parse(session.getItem('collab-draft:'+p.id)||'null');}catch{continue;}
    if(!draft||draft.editing||p.retiredCommentDraftRecovered||p.commentDraft||p.richText?.commentDraft)continue;
    if(typeof draft.text==='string'&&typeof draft.html==='string'&&(draft.text||draft.html)){
      p.commentDraft=draft.text;p.commentAuthor=typeof draft.title==='string'?draft.title:'';p.richText||={};p.richText.commentDraft=draft.html;p.retiredCommentDraftRecovered=true;
    }
  }
}
