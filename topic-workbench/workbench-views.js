import {isHistoryProject,lifecycleLabels,projectLifecycle} from './project-lifecycle.js';
import {DEFAULT_HISTORY_FILTER,resultsTimelineMarkup} from './results-timeline.js';
import {mountRichEditors, flushRichEditors, destroyRichEditors} from './rich-text.js?v=20261030-card-preview';
import {colorPickerMarkup,colorChoices} from './color-presets.js';
import {deliveryCases,todayDate} from './delivery-model.js';
import {deliveryCardMarkup,deliveryPageMarkup} from './delivery-view.js';
import {displayPriority,visibleNodes} from './presentation.js';
import {parentProjectRows} from './child-projects.js';
import {setProjectClosed} from './project-flow.js';
import {isClosedProject, sortProjectsByPriority, boardFromFrame, linkBoardToFrame} from './workbench-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
export const palette = colorChoices('accent').map(p=>p.value);
export function colorControl(value, attribute, id, label) {
  return colorPickerMarkup(value,attribute,id,label,{variant:attribute.includes('frame')?'surface':'accent'});
}

export function createWorkbenchViews(api) {
  const {getState,update,openProject,priorityControl,canMaintain,navigate,editor,field,area,matches} = api;
  const boardById = id => getState().quickBoards.find(b=>b.id===id);
  const pendingText = new Map(), composing = new WeakSet();
  let historyFilter=DEFAULT_HISTORY_FILTER;
  let flushingText = false, deferredRender = false, renameSession = null, creationDraft = null;
  function textIdentity(el){
    if(!el?.matches?.('[data-board-note],[data-board-context]'))return null;
    const kind=el.hasAttribute('data-board-note')?'note':'context';
    const boardId=kind==='note'?el.dataset.boardNote:el.dataset.boardContext,pid=kind==='context'?el.dataset.pid:'';
    return {key:JSON.stringify([kind,boardId,pid]),kind,boardId,pid};
  }
  /** Synchronously persist board text before navigation, snapshots or unloading. */
  function flush(){
    if(flushingText)return true;
    const view=$('workbenchView');
    if(!flushRichEditors(view))return false;
    for(const el of view.querySelectorAll('[data-timeline-pid][data-pending]')){
      if(!api.commitInline(el))return false;
    }
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
    if(identity.kind==='context'){
      const preview=el.previousElementSibling,visible=value.trim();
      preview.textContent=visible;
      el.parentElement.classList.toggle('is-empty',!visible);
      el.title=visible;
    }
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
    $('quickBoardNav').innerHTML=[...state.quickBoards].sort((a,b)=>a.rank-b.rank).map(b=>'<button class="sidebar-item'+(state.activeBoard===b.id?' current':'')+'"'+(state.activeBoard===b.id?' aria-current="page"':'')+' data-board-open="'+esc(b.id)+'"><span class="nav-color" style="background:'+esc(b.color)+'"></span><span>'+esc(b.name)+'</span><small>'+b.projectIds.length+'</small></button>').join('') || '<button class="sidebar-item board-start" data-create-board>新建或导入分组</button>';
    $('resultsCount').textContent=state.projects.filter(isHistoryProject).length;
    const overdue=deliveryCases(state).filter(r=>r.state.kind==='overdue'&&!r.removed).length;
    $('deliveryCount').textContent=overdue;$('deliveryCount').hidden=!overdue;
    $('deliveryReminder').hidden=!overdue||state.display!=='boards';$('deliveryReminder').textContent=overdue+' 项计划已超过承诺交付日 · 查看延期记录 →';
    for(const [id,selected] of [['canvasNav',['canvas','list'].includes(state.display)],['resultsNav',state.display==='results'],['deliveryNav',state.display==='delivery']]){
      $(id).classList.toggle('active',selected);selected?$(id).setAttribute('aria-current','page'):$(id).removeAttribute('aria-current');
    }
  }
  function render(){
    const position=editorPosition(),state=getState();
    if(position&&composing.has(document.activeElement)&&state.display==='boards'&&state.activeBoard===position.boardId){deferredRender=true;return;}
    if(!flush())return;
    deferredRender=false;
    destroyRichEditors($('workbenchView'));
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
    if(!board){view.hidden=true;return;}
    renderBoard(view,board,state);
  }

  function renderBoard(view,board,state){
    const editable=canMaintain(),all=boardProjects(board),rows=all.filter(matches);
    const frame=state.frames.find(frame=>frame.id===board.sourceFrameId);
    const id=esc(board.id),title=esc(board.name),note=board.notes?.trim()||'';
    $('pageTitle').innerHTML=editable
      ? '<button type="button" class="board-title" data-board-title="'+id+'" data-board-rename="'+id+'" aria-label="修改看板名称：'+title+'" title="点击修改名称">'+title+'</button>'
      : title;
    const count=(rows.length===all.length?rows.length:rows.length+' / '+all.length)+' 个项目';
    const today=todayDate();
    view.innerHTML='<section class="action-board"><header class="action-board-bar"><div class="action-board-meta">'+
      (editable?colorControl(board.color,'data-board-color',board.id,'调整看板颜色'):'<span class="nav-color" style="background:'+esc(board.color)+'"></span>')+
      '<span class="action-board-count">'+count+'</span>'+
      (frame?'<span class="action-board-link" title="随分组自动更新">关联分组 <strong>'+esc(frame.name)+'</strong></span>':'')+
      '</div>'+(editable?'<div class="action-board-tools"><button type="button" data-board-edit="'+id+'">设置</button><button type="button" class="primary" data-board-members="'+id+'">加入项目</button></div>':'')+'</header>'+
      (note&&editable?'<textarea class="inline-text action-board-note" data-board-note="'+id+'" aria-label="看板说明" placeholder="添加看板说明…" rows="1">'+esc(board.notes)+'</textarea>':
        note?'<p class="action-board-note">'+esc(note)+'</p>':'')+
      (rows.length?'<div class="board-ledger" role="table" aria-label="'+title+'的项目"><div class="board-ledger-head" role="row"><div role="columnheader">项目</div><div role="columnheader">优先级</div><div role="columnheader">交付</div><div role="columnheader">本板备注</div>'+(editable?'<div role="columnheader"><span class="sr-only">操作</span></div>':'')+'</div>'+
        rows.map(project=>boardRowMarkup(project,board,state,editable,today)).join('')+'</div>':
        '<div class="view-empty action-board-empty"><strong>'+(!board.projectIds.length?'尚未加入项目':all.length?'没有匹配的项目':'本板项目已全部结束')+'</strong><p>'+(!board.projectIds.length?'同一项目可以加入多个行动看板。':all.length?'清除筛选后查看全部。':'结项记录可在成果与历史中查看。')+'</p>'+
        (!board.projectIds.length&&editable?'<button type="button" data-board-members="'+id+'">＋ 选择项目</button>':'')+'</div>')+'</section>';
  }
  function boardRowMarkup(project,board,state,editable,today){
    const id=esc(board.id),pid=esc(project.id),name=esc(project.name),priority=displayPriority(project);
    const frozen=projectLifecycle(project)==='frozen',emphasized=board.emphasisIds.includes(project.id);
    const nodes=visibleNodes(project),owner=nodes.find(node=>node.focus&&node.owner)?.owner||nodes.find(node=>node.owner)?.owner;
    const plan=deliveryCardMarkup(project,{today,compact:true})||(owner?'<span class="board-ledger-owner" title="'+esc(owner)+'">'+esc(owner)+'</span>':'');
    const context=board.contexts?.[project.id]||'',note=esc(context.trim());
    const parents=parentProjectRows(project.id,state);
    const parentLabel=parents.length?'所属主项目：'+parents.map(({project,draft})=>project.name+(draft?'（待确认）':'')).join('、'):'';
    const marker=parentLabel?'<span class="board-ledger-kind" role="img" aria-label="'+esc(parentLabel)+'" title="'+esc(parentLabel)+'"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 11.5H8a3 3 0 0 1-3-3v-4m-2 2 2-2 2 2"/></svg></span>':
      project.kind==='direction'?'<span class="board-ledger-kind" role="img" aria-label="主方向" title="主方向"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4v5a3 3 0 0 0 3 3h4M4 7h7"/><circle cx="4" cy="3" r="1.25"/><circle cx="12" cy="7" r="1.25"/><circle cx="12" cy="12" r="1.25"/></svg></span>':'';
    const noteEditor='<div class="board-context-editor'+(note?'':' is-empty')+'"><span class="board-context-preview" aria-hidden="true">'+note+'</span>'+
      '<textarea class="inline-text" data-board-context="'+id+'" data-pid="'+pid+'" aria-label="'+name+'在此看板的备注" title="'+note+'" placeholder="添加备注…" rows="2">'+esc(context)+'</textarea></div>';
    const noteReader=note?'<details class="board-context-reader"><summary aria-label="查看本板备注" title="'+note+'"><span>'+note+'</span><span class="board-context-collapse">收起备注</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"/></svg></summary><p>'+note+'</p></details>':'';
    return '<div class="board-ledger-row'+(emphasized?' emphasized':'')+(frozen?' frozen':'')+'" role="row" data-project-highlight="'+pid+'" style="--board-color:'+esc(board.color)+'">'+
      '<div class="board-ledger-project" role="cell"><div class="board-ledger-title"><button type="button" data-project-open="'+pid+'" title="'+name+'">'+name+'</button>'+marker+
      (frozen?'<span class="lifecycle-badge frozen">'+lifecycleLabels.frozen+'</span>':'')+(emphasized?'<span class="board-ledger-pin" role="img" aria-label="本板重点" title="本板重点">★</span>':'')+'</div></div>'+
      '<div class="board-ledger-priority" role="cell">'+(editable?priorityControl(project,true,'—'):priority?'<span class="priority" data-priority="'+esc(priority)+'">'+esc(priority)+'</span>':'')+'</div>'+
      '<div class="board-ledger-plan" role="cell">'+plan+'</div>'+
      '<div class="board-ledger-context" role="cell">'+(editable?noteEditor:noteReader)+'</div>'+
      (editable?'<div class="board-ledger-actions" role="cell"><div class="detail-menu board-row-menu"><button class="menu-trigger" type="button" aria-expanded="false" aria-label="'+name+'：更多操作" title="更多操作"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="16" cy="10" r=".9"/></svg></button>'+
        '<div class="detail-menu-content"><button type="button" class="text-action" data-focus-board-context>编辑备注</button>'+
        '<button type="button" class="text-action" data-board-star="'+id+'" data-pid="'+pid+'" aria-pressed="'+emphasized+'">'+(emphasized?'取消重点':'标为重点')+'</button>'+
        '<button type="button" class="text-action" data-board-remove="'+id+'" data-pid="'+pid+'">移出本板</button></div></div></div>':'')+'</div>';
  }
  function renderResults(view){
    view.innerHTML=resultsTimelineMarkup(getState(),matches,historyFilter);
    mountRichEditors(view,{onCommit:api.commitInline,onError:api.notify});
  }

  function renameBoard(id,trigger){
    if(!flush())return;const board=boardById(id);if(!board)return;
    const container=trigger.closest('#pageTitle');
    const title=container?.querySelector('[data-board-title]');if(!title)return;
    const input=document.createElement('input');input.className='board-name-input';input.setAttribute('aria-label','看板名称');input.value=board.name;input.required=true;input.maxLength=60;input.autocomplete='off';
    let finished=false;
    const restoreTitle=()=>{
      const live=boardById(id);if(!live)return;
      title.textContent=live.name;
      title.setAttribute('aria-label','修改看板名称：'+live.name);
      input.replaceWith(title);
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
  const nextBoardRank=()=>Math.max(-1,...getState().quickBoards.map(board=>board.rank))+1;
  function boardFields(b={}){
    return field('name','名称',b.name,'text','required maxlength="60"')+'<div class="form-field"><span>颜色</span>'+colorPickerMarkup(b.color||palette[0],'data-board-draft-color','draft','选择看板颜色',{name:'color'})+'</div>'+area('notes','看板说明',b.notes,3);
  }
  function rememberCreationDraft(){
    if(!creationDraft)return;
    const fields=$('editorFields');
    if(fields.querySelector('[name="name"]')){
      for(const key of ['name','color','notes'])creationDraft[key]=fields.querySelector('[name="'+key+'"]').value;
    }else creationDraft.frames=[...fields.querySelectorAll('[name="frame"]:checked')].map(el=>el.value);
  }
  function createBoardEditor(mode='blank'){
    creationDraft||={name:'',color:palette[0],notes:'',frames:[]};
    $('editorSubmit').disabled=false;
    const tabs='<div class="board-create-tabs" role="group" aria-label="看板创建方式"><button type="button" data-board-create-mode="blank" aria-pressed="'+(mode==='blank')+'">空白新建</button><button type="button" data-board-create-mode="frames" aria-pressed="'+(mode==='frames')+'">从分组导入</button></div>';
    if(mode==='blank'){
      editor('新建行动看板',tabs+boardFields(creationDraft),form=>{
        const id='board-'+crypto.randomUUID();
        const ok=update(()=>{
          const name=form.get('name').trim();if(!name)throw Error('请填写看板名称');
          getState().quickBoards.push({id,name,color:form.get('color'),notes:form.get('notes').trim(),projectIds:[],emphasisIds:[],contexts:{},rank:nextBoardRank(),sourceFrameId:null});
        },'看板已新建',{rollbackOnSaveFailure:true});
        if(ok!==false)navigate('boards',id);return ok;
      },'创建看板');
      return;
    }
    const state=getState();
    const rows=state.frames.map(frame=>{
      const board=boardFromFrame(state,frame.id,{id:'preview'}),names=board.projectIds.map(id=>state.projects.find(p=>p.id===id)?.name).filter(Boolean);
      const linked=state.quickBoards.some(b=>b.sourceFrameId===frame.id);
      return '<label class="member-option frame-import-option" data-search-text="'+esc(frame.name+' '+names.join(' '))+'"><input type="checkbox" name="frame" value="'+esc(frame.id)+'"'+(creationDraft.frames.includes(frame.id)?' checked':'')+'><span class="frame-import-copy"><strong>'+esc(frame.name)+'</strong><small>'+esc(names.slice(0,3).join('、'))+(names.length>3?'…':'')+'</small></span><span class="frame-import-count">'+(linked?'已关联 · ':'')+names.length+' 项</span></label>';
    }).join('');
    editor('新建行动看板',tabs+(rows?'<p class="board-import-hint">导入后随分组更新，保留本板单独填写的备注与重点。</p><label class="member-search">搜索分组<input type="search" data-member-search placeholder="分组或项目名称"></label><div class="member-options frame-import-options">'+rows+'</div>':'<p class="board-import-hint">画板里还没有分组，可先空白新建。</p>'),form=>{
      const selected=[...new Set(form.getAll('frame'))];if(!selected.length)throw Error('请选择至少一个分组');
      const ids=[];
      const ok=update(()=>{
        for(const frameId of selected){
          const linked=getState().quickBoards.find(board=>board.sourceFrameId===frameId);
          if(linked){ids.push(linked.id);continue;}
          const frame=getState().frames.find(f=>f.id===frameId),color=frame?.backgroundColor||frame?.color;
          const presetIndex=colorChoices('surface').findIndex(p=>p.value===color);
          const id='board-'+crypto.randomUUID();ids.push(id);
          getState().quickBoards.push(boardFromFrame(getState(),frameId,{id,rank:nextBoardRank(),color:presetIndex<0?color:palette[presetIndex]}));
        }
      },'已导入 '+selected.length+' 个分组',{rollbackOnSaveFailure:true});
      if(ok!==false)navigate('boards',ids[0]);return ok;
    },'导入为看板');
    $('editorSubmit').disabled=!rows;
  }
  function boardEditor(id,mode='blank'){
    if(!flush())return;
    if(!id){creationDraft=null;createBoardEditor(mode);return;}
    const b=boardById(id)||{};
    const sourceField='<label class="form-field"><span>关联分组</span><select name="sourceFrameId"><option value="">独立看板</option>'+getState().frames.map(frame=>'<option value="'+esc(frame.id)+'"'+(b.sourceFrameId===frame.id?' selected':'')+'>'+esc(frame.name)+'</option>').join('')+'</select><small>关联后项目随分组更新；选择独立看板可停止同步。</small></label>';
    editor('看板设置',boardFields(b)+sourceField+'<button type="button" class="danger-link" data-delete-board="'+esc(id)+'">删除看板，保留项目</button>',form=>update(()=>{
      const values={name:form.get('name').trim(),color:form.get('color'),notes:form.get('notes').trim()};if(!values.name)throw Error('请填写看板名称');
      const board=boardById(id),previous={name:board.name,color:board.color};
      const changed=linkBoardToFrame(getState(),id,form.get('sourceFrameId'));
      for(const field of ['name','color'])if(!changed||!board.sourceFrameId||values[field]!==previous[field])board[field]=values[field];
      board.notes=values.notes;
    },'看板已保存'));
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-board-open],[data-board-members],[data-board-edit],[data-board-rename],[data-create-board],[data-import-frames],[data-board-create-mode],[data-project-open],[data-focus-board-context],[data-board-remove],[data-board-star],[data-delete-board],[data-reopen-project],[data-history-filter]');if(!b)return;
    if(b.hasAttribute('data-history-filter')){if(!flush())return;historyFilter=b.dataset.historyFilter;render();$('workbenchView').querySelector('[data-history-filter="'+historyFilter+'"]')?.focus({preventScroll:true});return;}
    if(b.hasAttribute('data-board-open')){navigate('boards',b.dataset.boardOpen);return;}
    if(b.hasAttribute('data-project-open')){openProject(b.dataset.projectOpen);return;}
    if(b.hasAttribute('data-board-members')){membersEditor(b.dataset.boardMembers);return;}
    if(b.hasAttribute('data-board-rename')){renameBoard(b.dataset.boardRename,b);return;}
    if(b.hasAttribute('data-board-edit')){boardEditor(b.dataset.boardEdit);return;}
    if(b.hasAttribute('data-create-board')){boardEditor();return;}
    if(b.hasAttribute('data-import-frames')){boardEditor(null,'frames');return;}
    if(b.hasAttribute('data-board-create-mode')){rememberCreationDraft();createBoardEditor(b.dataset.boardCreateMode);return;}
    if(b.hasAttribute('data-delete-board')){removeBoard(b.dataset.deleteBoard);return;}
    if(b.hasAttribute('data-reopen-project')){update(()=>{const p=getState().projects.find(p=>p.id===b.dataset.reopenProject);setProjectClosed(p,false);},'已恢复跟进，历史结果保留');return;}
    if(!canMaintain()||!flush())return;
    const row=b.closest('.board-ledger-row');
    if(b.hasAttribute('data-focus-board-context')){
      const textarea=row?.querySelector('[data-board-context]');
      const menu=b.closest('.detail-menu');menu.removeAttribute('open');menu.querySelector('.menu-trigger').setAttribute('aria-expanded','false');
      textarea?.focus({preventScroll:true});
      textarea?.scrollIntoView({block:'nearest'});
      return;
    }
    const id=b.dataset.boardRemove||b.dataset.boardStar,pid=b.dataset.pid,remove=b.hasAttribute('data-board-remove');
    const focusPid=remove?(row?.nextElementSibling?.dataset.projectHighlight||row?.previousElementSibling?.dataset.projectHighlight):pid;
    if(update(()=>{
      const board=boardById(id);
      if(remove){
        board.projectIds=board.projectIds.filter(x=>x!==pid);
        board.emphasisIds=board.emphasisIds.filter(x=>x!==pid);
        delete board.contexts?.[pid];
      }else board.emphasisIds=board.emphasisIds.includes(pid)?board.emphasisIds.filter(x=>x!==pid):[...board.emphasisIds,pid];
    },remove?'已移出本板，可撤销':'')!==false&&e.detail===0){
      [...$('workbenchView').querySelectorAll('[data-project-open]')].find(button=>button.dataset.projectOpen===focusPid)?.focus({preventScroll:true});
    }
  });
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-board-color]'))update(()=>boardById(el.dataset.boardColor).color=el.value);
    if(textIdentity(el))saveText(el);
  });
  document.addEventListener('input',e=>{
    if(textIdentity(e.target))saveText(e.target);
    if(e.target.matches('[data-member-search]')){$('editorFields').querySelectorAll('.member-option').forEach(row=>row.hidden=!(row.dataset.searchText||row.textContent).toLowerCase().includes(e.target.value.toLowerCase()));}
  });
  document.addEventListener('compositionstart',e=>{if(textIdentity(e.target))composing.add(e.target);});
  document.addEventListener('compositionend',e=>{if(!textIdentity(e.target))return;composing.delete(e.target);saveText(e.target);if(deferredRender)render();});
  return {render,renderNav,boardEditor,membersEditor,flush,historyFilter:()=>historyFilter,setHistoryFilter:filter=>{historyFilter=filter;render();}};
}
