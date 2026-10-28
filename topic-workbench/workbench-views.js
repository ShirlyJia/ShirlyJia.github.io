import {deliveryCases} from './delivery-model.js';
import {deliveryPageMarkup} from './delivery-view.js';
import {setProjectClosed} from './project-flow.js';
import {isClosedProject, sortProjectsByPriority, outcomeKind} from './workbench-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
export const palette = ['#bd6259','#bd9146','#6284a0','#668777','#9080a1','#8c8981'];
export function colorControl(value, attribute, id, label) {
  return '<label class="color-control" title="'+esc(label)+'"><input type="color" '+attribute+'="'+esc(id)+'" value="'+esc(value||palette[5])+'" aria-label="'+esc(label)+'"><span style="background:'+esc(value||palette[5])+'"></span></label>';
}

export function createWorkbenchViews(api) {
  const {getState,update,openProject,cardElement,navigate,editor,field,area,matches} = api;
  const boardById = id => getState().quickBoards.find(b=>b.id===id);
  const pendingText = new Map(), composing = new WeakSet();
  let flushingText = false, deferredRender = false, renameSession = null;
  function textIdentity(el){
    if(!el?.matches?.('[data-board-note],[data-board-context]'))return null;
    const kind=el.hasAttribute('data-board-note')?'note':'context';
    const boardId=kind==='note'?el.dataset.boardNote:el.dataset.boardContext,pid=kind==='context'?el.dataset.pid:'';
    return {key:JSON.stringify([kind,boardId,pid]),kind,boardId,pid};
  }
  /** Synchronously persist board text before navigation, snapshots or unloading. */
  function flush(){
    if(flushingText)return true;
    if(renameSession&&renameSession.finish()===false)return false;
    const entries=[...pendingText.values()].filter(entry=>{
      const board=boardById(entry.boardId),valid=board&&(entry.kind==='note'||board.projectIds.includes(entry.pid));
      if(!valid)pendingText.delete(entry.key);
      return valid;
    });
    if(!entries.length)return true;
    flushingText=true;
    try{
      const ok=update(()=>entries.forEach(entry=>{
        const board=boardById(entry.boardId);
        if(entry.kind==='note')board.notes=entry.value;
        else {board.contexts||={};board.contexts[entry.pid]=entry.value;}
      }),'',{keepMain:true,keepDetail:true})!==false;
      if(ok)entries.forEach(entry=>{if(pendingText.get(entry.key)===entry)pendingText.delete(entry.key);});
      return ok;
    }finally{flushingText=false;}
  }
  function saveText(el){
    const identity=textIdentity(el);if(!identity)return true;
    const board=boardById(identity.boardId);if(!board)return true;
    const value=el.value,current=identity.kind==='note'?board.notes:(board.contexts?.[identity.pid]||'');
    if(current===value&&!pendingText.has(identity.key))return true;
    pendingText.set(identity.key,{...identity,value});
    return flush();
  }
  function editorPosition(){
    const el=document.activeElement,identity=textIdentity(el);
    return identity?{...identity,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,scrollTop:el.scrollTop,scrollLeft:el.scrollLeft,viewScroll:$('workbenchView').scrollTop}:null;
  }
  function restoreEditor(position){
    if(!position||getState().display!=='boards'||getState().activeBoard!==position.boardId)return;
    const el=[...$('workbenchView').querySelectorAll('[data-board-note],[data-board-context]')].find(el=>textIdentity(el)?.key===position.key);
    if(!el)return;
    el.focus({preventScroll:true});
    el.setSelectionRange(position.start,position.end,position.direction||'none');
    el.scrollTop=position.scrollTop;el.scrollLeft=position.scrollLeft;$('workbenchView').scrollTop=position.viewScroll;
  }
  const boardProjects = board => {
    const state=getState();
    return sortProjectsByPriority(state.projects.filter(p=>board.projectIds.includes(p.id)&&!isClosedProject(p)))
      .sort((a,b)=>Number(board.emphasisIds.includes(b.id))-Number(board.emphasisIds.includes(a.id)));
  };
  function renderNav(){
    const state=getState();
    $('quickBoardNav').innerHTML=[...state.quickBoards].sort((a,b)=>a.rank-b.rank).map(b=>'<button class="sidebar-item'+(state.activeBoard===b.id?' current':'')+'" data-board-open="'+esc(b.id)+'"><span class="nav-color" style="background:'+esc(b.color)+'"></span><span>'+esc(b.name)+'</span><small>'+b.projectIds.length+'</small></button>').join('');
    $('resultsCount').textContent=state.projects.filter(isClosedProject).length;
    const overdue=deliveryCases(state).filter(r=>r.state.kind==='overdue'&&!r.removed).length;
    $('deliveryCount').textContent=overdue;$('deliveryCount').hidden=!overdue;
    $('deliveryReminder').hidden=!overdue||state.display!=='boards';$('deliveryReminder').textContent=overdue+' 项计划已超过承诺交付日 · 查看延期记录 →';
    for(const [id,selected] of [['homeNav',state.display==='boards'&&!state.activeBoard],['canvasNav',state.display==='canvas'],['resultsNav',state.display==='results'],['deliveryNav',state.display==='delivery']]){
      $(id).classList.toggle('active',selected);selected?$(id).setAttribute('aria-current','page'):$(id).removeAttribute('aria-current');
    }
  }
  function render(){
    const position=editorPosition(),state=getState();
    if(position&&composing.has(document.activeElement)&&state.display==='boards'&&state.activeBoard===position.boardId){deferredRender=true;return;}
    if(!flush())return;
    deferredRender=false;
    renderContent();
    restoreEditor(position);
    api.afterRender?.();
  }
  function renderContent(){
    const state=getState(),view=$('workbenchView');
    view.hidden=!['boards','results','delivery'].includes(state.display);if(view.hidden)return;
    if(state.display==='delivery'){view.innerHTML=deliveryPageMarkup(state,{filter:state.deliveryFilter,query:state.deliveryQuery});return;}
    if(state.display==='results'){renderResults(view);return;}
    const board=boardById(state.activeBoard);
    $('pageTitle').textContent=board?board.name:'推进总览';
    if(board){
      view.innerHTML='<header class="board-page-head"><div><span class="section-kicker">行动看板</span><h2>'+colorControl(board.color,'data-board-color',board.id,'调整看板颜色')+'<button class="board-title" data-board-title="'+esc(board.id)+'" data-board-rename="'+esc(board.id)+'" aria-label="修改看板名称：'+esc(board.name)+'" title="点击修改名称">'+esc(board.name)+'</button></h2></div><div class="board-actions"><button data-board-edit="'+esc(board.id)+'">编辑说明</button><button data-delete-board="'+esc(board.id)+'" aria-label="删除看板：'+esc(board.name)+'">删除</button><button class="primary" data-board-members="'+esc(board.id)+'">＋ 项目</button></div></header><textarea class="board-note inline-text" data-board-note="'+esc(board.id)+'" aria-label="看板说明" placeholder="本看板要解决什么、需要准备什么…" rows="2">'+esc(board.notes)+'</textarea><div class="board-project-grid" id="activeBoardCards"></div>';
      const target=$('activeBoardCards'),rows=boardProjects(board).filter(matches);const hasOpen=boardProjects(board).length>0;
      rows.forEach(p=>{
        const wrap=document.createElement('div');wrap.className='board-project'+(board.emphasisIds.includes(p.id)?' emphasized':'');wrap.style.setProperty('--board-color',board.color);
        const card=cardElement(p);card.addEventListener('click',e=>{if(!e.target.closest('select,input,button'))openProject(p.id);});wrap.append(card);
        const extra=document.createElement('div');extra.className='board-project-context';
        extra.innerHTML='<div class="board-project-actions"><button data-board-star="'+esc(board.id)+'" data-pid="'+esc(p.id)+'" aria-pressed="'+board.emphasisIds.includes(p.id)+'">'+(board.emphasisIds.includes(p.id)?'★ 本板重点':'☆ 标重点')+'</button><button data-board-remove="'+esc(board.id)+'" data-pid="'+esc(p.id)+'">移出本板</button></div><textarea class="inline-text" data-board-context="'+esc(board.id)+'" data-pid="'+esc(p.id)+'" aria-label="'+esc(p.name)+'在此看板的备注" placeholder="本看板的讨论备注…" rows="2">'+esc(board.contexts?.[p.id]||'')+'</textarea>';
        wrap.append(extra);target.append(wrap);
      });
      if(!rows.length)target.innerHTML='<div class="view-empty"><strong>'+(!board.projectIds.length?'尚未加入项目':hasOpen?'没有匹配的项目':'本板项目已全部结束')+'</strong><p>'+(!board.projectIds.length?'选择项目加入；同一项目可以出现在多个看板。':hasOpen?'清除筛选后查看全部。':'结项记录可在成果与历史中查看。')+'</p>'+(!board.projectIds.length?'<button data-board-members="'+esc(board.id)+'">＋ 选择项目</button>':'')+'</div>';
      return;
    }
    view.innerHTML='<div class="overview-heading"><div><h2>这段时间，先推进什么</h2><p>按准备、对齐与交付来组织。每个看板可独立记备注。</p></div><button data-create-board>＋ 新建看板</button></div><div class="quick-board-grid" id="quickBoardGrid"></div><div class="section-row"><h2>进行中的项目</h2><span>P0 → P1 → P2</span></div><div class="overview-projects" id="overviewProjects"></div>';
    $('quickBoardGrid').innerHTML=[...state.quickBoards].sort((a,b)=>a.rank-b.rank).map(b=>{
      const rows=boardProjects(b).filter(p=>matches(p));
      return '<section class="quick-board" data-quick-board="'+esc(b.id)+'" style="--board-color:'+esc(b.color)+'"><header><div class="quick-board-heading"><span class="nav-color" style="background:'+esc(b.color)+'"></span><button class="board-title" data-board-title="'+esc(b.id)+'" data-board-rename="'+esc(b.id)+'" aria-label="修改看板名称：'+esc(b.name)+'" title="点击修改名称"><strong>'+esc(b.name)+'</strong></button><small>'+b.projectIds.length+'</small></div><div class="quick-board-actions">'+colorControl(b.color,'data-board-color',b.id,'调整'+b.name+'颜色')+'<button data-board-open="'+esc(b.id)+'" aria-label="进入看板：'+esc(b.name)+'">进入 ↗</button><button data-delete-board="'+esc(b.id)+'" aria-label="删除看板：'+esc(b.name)+'" title="删除看板，项目保留；可撤销">删除</button></div></header><p>'+esc(b.notes)+'</p><div class="quick-projects">'+rows.slice(0,4).map(p=>'<button data-project-highlight="'+esc(p.id)+'" data-project-open="'+esc(p.id)+'"><span class="priority" data-priority="'+esc(p.priority)+'">'+esc(p.priority==='待定'?'—':p.priority||'—')+'</span><span>'+esc(p.name)+'</span></button>').join('')+'</div>'+(rows.length>4?'<button class="more-link" data-board-open="'+esc(b.id)+'">查看全部 '+rows.length+' 项 →</button>':'')+(!b.projectIds.length?'<button class="board-empty-add" data-board-members="'+esc(b.id)+'">＋ 选择项目加入</button>':'')+'</section>';
    }).join('');
    const target=$('overviewProjects'),open=sortProjectsByPriority(state.projects.filter(p=>!isClosedProject(p)&&matches(p)));
    open.forEach(p=>{const card=cardElement(p);card.addEventListener('click',e=>{if(!e.target.closest('select,input,button'))openProject(p.id);});target.append(card);});
    if(!open.length)target.innerHTML='<p class="muted">没有匹配的项目。</p>';
  }
  function renderResults(view){
    const state=getState(),allEnded=state.projects.filter(isClosedProject),ended=sortProjectsByPriority(allEnded.filter(matches));
    view.innerHTML='<div class="overview-heading"><div><h2>成果与历史</h2><p>项目结束后，沉淀解决的问题、结果与证据。</p></div>'+(allEnded.length?'<button data-record-result>＋ 补充成果</button>':'')+'</div><div id="resultsContent"></div>';
    const target=$('resultsContent');
    if(!ended.length){target.innerHTML='<div class="view-empty"><strong>'+(allEnded.length?'没有匹配的结项记录':'还没有结项记录')+'</strong><p>'+(allEnded.length?'清除筛选后查看已结束项目。':'推进中的项目无需填写成果。可直接记录已结项目，或在项目详情中结束项目后补充成果，并保留在所属主项目中。')+'</p></div>';return;}
    for(const [kind,title] of [['resolved','已解决 / 已交付'],['stopped','已结束，问题未解决'],['ended','其他结项记录']]){
      const rows=ended.filter(p=>outcomeKind(p)===kind);if(!rows.length)continue;
      target.insertAdjacentHTML('beforeend','<div class="section-row"><h3>'+title+'</h3><span>'+rows.length+' 项</span></div><div class="outcome-grid">'+rows.map(p=>'<article class="outcome-card" data-project-highlight="'+esc(p.id)+'"><header><span>'+esc(p.outcome||'已结束')+'</span><time>'+esc(p.closedAt||'')+'</time></header><button data-project-open="'+esc(p.id)+'"><h3>'+esc(p.name)+'</h3></button><p class="outcome-result">'+esc(p.result||'待补充结果')+'</p>'+(p.impact?'<p>'+esc(p.impact)+'</p>':'')+'<footer><span>'+p.materials.length+' 份资料</span><button data-project-open="'+esc(p.id)+'">查看与补充 →</button><button data-reopen-project="'+esc(p.id)+'">恢复跟进</button></footer></article>').join('')+'</div>');
    }
  }

  function renameBoard(id,trigger){
    if(!flush())return;const board=boardById(id);if(!board)return;
    const container=trigger.closest('.quick-board,.board-page-head');
    const title=container?.querySelector('[data-board-title]');if(!title)return;
    const input=document.createElement('input');input.className='board-name-input';input.setAttribute('aria-label','看板名称');input.value=board.name;input.required=true;input.maxLength=60;input.autocomplete='off';
    let finished=false;
    const restoreTitle=()=>{
      const live=boardById(id);if(!live)return;
      const strong=title.querySelector('strong');if(strong)strong.textContent=live.name;else title.textContent=live.name;
      input.replaceWith(title);
      container.querySelector('[data-board-rename]')?.setAttribute('aria-label','修改看板名称：'+live.name);
      container.querySelector('[data-board-open]')?.setAttribute('aria-label','进入看板：'+live.name);
      container.querySelector('[data-delete-board]')?.setAttribute('aria-label','删除看板：'+live.name);
      if(getState().activeBoard===id)$('pageTitle').textContent=live.name;
    };
    const finish=commit=>{
      if(finished)return true;
      const name=input.value.trim();
      if(commit&&!name){input.setCustomValidity('请填写看板名称');input.reportValidity();return false;}
      finished=true;renameSession=null;
      if(commit&&name!==boardById(id)?.name){if(update(()=>{const live=boardById(id);if(live)live.name=name;},'看板已改名',{keepMain:true,keepDetail:true})===false){finished=false;return false;}}
      restoreTitle();return true;
    };
    input.addEventListener('input',()=>input.setCustomValidity(''));
    input.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(finish(true))container.querySelector('[data-board-rename]')?.focus({preventScroll:true});}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);container.querySelector('[data-board-rename]')?.focus({preventScroll:true});}});
    input.addEventListener('blur',()=>finish(!!input.value.trim()));
    renameSession={finish:()=>finish(true)};title.replaceWith(input);input.focus();input.select();
  }
  function removeBoard(id){
    if(!boardById(id)||!flush())return;
    if(update(()=>{getState().quickBoards=getState().quickBoards.filter(board=>board.id!==id);if(getState().activeBoard===id)getState().activeBoard=null;},'看板已删除，项目保留；可用顶部「撤销」恢复')!==false){
      if($('editorDialog').open)$('editorDialog').close();
    }
  }

  function membersEditor(id){
    const b=boardById(id);if(!b)return;
    editor('添加项目 · '+b.name,'<label class="member-search">搜索项目<input type="search" data-member-search placeholder="输入标题"></label><div class="member-options">'+sortProjectsByPriority(getState().projects).map(p=>'<label class="member-option"><input type="checkbox" name="member" value="'+esc(p.id)+'"'+(b.projectIds.includes(p.id)?' checked':'')+'><span>'+esc(p.name)+'</span><small>'+esc(p.priority==='待定'?'':p.priority)+'</small></label>').join('')+'</div>',form=>update(()=>{const current=boardById(id);current.projectIds=form.getAll('member');current.emphasisIds=current.emphasisIds.filter(pid=>current.projectIds.includes(pid));current.contexts=Object.fromEntries(Object.entries(current.contexts||{}).filter(([pid])=>current.projectIds.includes(pid)));},'看板项目已更新'));
  }
  function boardEditor(id){
    if(!flush())return;
    const b=boardById(id)||{};
    editor(id?'看板设置':'新建行动看板',field('name','名称',b.name,'text','required maxlength="60"')+field('color','颜色',b.color||palette[5],'color')+area('notes','看板说明',b.notes,3)+(id?'<button type="button" class="danger-link" data-delete-board="'+esc(id)+'">删除看板，保留项目</button>':''),form=>update(()=>{
      const values={name:form.get('name').trim(),color:form.get('color'),notes:form.get('notes').trim()};if(!values.name)throw Error('请填写看板名称');
      if(id)Object.assign(boardById(id),values);else getState().quickBoards.push({id:'board-'+crypto.randomUUID(),...values,projectIds:[],emphasisIds:[],contexts:{},rank:Math.max(-1,...getState().quickBoards.map(board=>board.rank))+1});
    },'看板已保存'));
  }
  $('workbenchView').addEventListener('keydown',event=>{
    if(event.target.closest('[data-board-title]')&&(event.code==='Space'||event.key===' '))event.stopPropagation();
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-board-open],[data-board-members],[data-board-edit],[data-board-rename],[data-create-board],[data-project-open],[data-board-remove],[data-board-star],[data-delete-board],[data-record-result],[data-reopen-project]');if(!b)return;
    if(b.hasAttribute('data-board-open')){navigate('boards',b.dataset.boardOpen);return;}
    if(b.hasAttribute('data-project-open')){openProject(b.dataset.projectOpen);return;}
    if(b.hasAttribute('data-board-members')){membersEditor(b.dataset.boardMembers);return;}
    if(b.hasAttribute('data-board-rename')){renameBoard(b.dataset.boardRename,b);return;}
    if(b.hasAttribute('data-board-edit')){boardEditor(b.dataset.boardEdit);return;}
    if(b.hasAttribute('data-create-board')){boardEditor();return;}
    if(b.hasAttribute('data-delete-board')){removeBoard(b.dataset.deleteBoard);return;}
    if(b.hasAttribute('data-record-result')){const ended=sortProjectsByPriority(getState().projects.filter(isClosedProject));if(!ended.length)return;editor('为已结束项目补充成果','<div class="member-options">'+ended.map(p=>'<label class="member-option"><input type="radio" name="pid" required value="'+esc(p.id)+'"><span>'+esc(p.name)+'</span></label>').join('')+'</div>',f=>{openProject(f.get('pid'));document.querySelector('[data-inline="result"]')?.focus();},'打开项目');return;}
    if(b.hasAttribute('data-reopen-project')){update(()=>{const p=getState().projects.find(p=>p.id===b.dataset.reopenProject);setProjectClosed(p,false);},'已恢复跟进，历史结果保留');return;}
    const id=b.dataset.boardRemove||b.dataset.boardStar,pid=b.dataset.pid;
    update(()=>{const board=boardById(id);if(b.hasAttribute('data-board-remove')){board.projectIds=board.projectIds.filter(x=>x!==pid);board.emphasisIds=board.emphasisIds.filter(x=>x!==pid);delete board.contexts?.[pid];}else board.emphasisIds=board.emphasisIds.includes(pid)?board.emphasisIds.filter(x=>x!==pid):[...board.emphasisIds,pid];});
  });
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-board-color]'))update(()=>boardById(el.dataset.boardColor).color=el.value);
    if(textIdentity(el))saveText(el);
  });
  document.addEventListener('input',e=>{
    if(textIdentity(e.target))saveText(e.target);
    if(e.target.matches('[data-member-search]')){$('editorFields').querySelectorAll('.member-option').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase()));}
  });
  document.addEventListener('compositionstart',e=>{if(textIdentity(e.target))composing.add(e.target);});
  document.addEventListener('compositionend',e=>{if(!textIdentity(e.target))return;composing.delete(e.target);saveText(e.target);if(deferredRender)render();});
  return {render,renderNav,boardEditor,membersEditor,flush};
}
