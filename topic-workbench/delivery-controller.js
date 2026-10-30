import {deliveryState, updateDelivery, removeDeliveryNode, todayDate} from './delivery-model.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Delivery edits use one modal entry point; model validation remains authoritative. */
export function createDeliveryController({getState,mutate,flush,editor,field,area,check,toast=()=>{},storageKey=key=>key}={}) {
  const actorKey=storageKey('delivery-actor');
  let formController=null;
  function start(){if(flush()===false)return false;formController?.abort();formController=null;return true;}
  function locate(pid,nid) {
    const project=getState().projects.find(item=>item.id===pid),node=project?.planNodes.find(item=>item.id===nid);
    if(!project||!node){toast('这条计划已不存在');return null;}
    return {project,node};
  }
  function isTracked(project,node) {
    return !!node.delivery||!!(node.dateConfirmed&&node.estimatedDate)||(getState().deliveryEvents||[]).some(event=>event.projectId===project.id&&event.nodeId===node.id);
  }
  function actor() {try{return localStorage.getItem(actorKey)||'';}catch{return '';}}
  function rememberActor(value) {try{localStorage.setItem(actorKey,value);}catch{/* A remembered signature is optional. */}}
  function actorField() {return field('deliveryActor','记录人（选填）',actor(),'text','maxlength="80" placeholder="署名"');}
  function context(project,node) {return '<div class="delivery-editor-context"><strong>'+esc(project.name)+'</strong><p>'+esc(node.title||'未命名计划')+'</p></div>';}
  function reasonField(label='调整理由') {return '<div data-delivery-reason>'+area('deliveryReason',label,'',3)+'</div>';}
  function bindForm({reasonRequired,always=false}={}) {
    formController?.abort();formController=new AbortController();
    const host=document.getElementById('editorFields'),reason=host?.querySelector('[name="deliveryReason"]'),box=host?.querySelector('[data-delivery-reason]');
    if(!host||!reason)return;
    const update=()=>{
      if(!host.contains(reason))return;
      const required=always||!!reasonRequired?.(host);
      reason.required=required;reason.setAttribute('aria-required',String(required));
      if(box)box.hidden=!required;
    };
    host.addEventListener('input',update,{signal:formController.signal});
    host.addEventListener('change',update,{signal:formController.signal});update();
  }
  function submit(pid,nid,patch,form,message) {
    if(flush()===false)return false;
    const recordActor=String(form.get('deliveryActor')||'').trim(),reason=String(form.get('deliveryReason')||'').trim();
    const ok=mutate(()=>updateDelivery(getState(),pid,nid,patch,{reason,actor:recordActor}),message,{rollbackOnSaveFailure:true});
    if(ok!==false)rememberActor(recordActor);
    return ok;
  }
  function edit(pid,nid) {
    if(!start())return false;const found=locate(pid,nid);if(!found)return false;
    const {project,node}=found,state=deliveryState(project,node),tracked=!!node.delivery||!!(node.dateConfirmed&&node.estimatedDate);
    const existingDate=node.delivery?.committedDate||node.estimatedDate||'',oldEstimate=node.estimatedDate||'',oldConfirmed=!!node.dateConfirmed;
    const previous=tracked&&existingDate?'<p class="delivery-previous-date">上次确认的交付日 <strong><time>'+esc(existingDate)+'</time></strong></p>':'';
    const expected='<details class="delivery-expected-date"'+(node.targetDate?' open':'')+'><summary>期望日期（选填）</summary>'+field('targetDate','期望日期',node.targetDate||'','date')+'</details>';
    editor('调整交付日期',context(project,node)+previous+field('estimatedDate','承诺交付日',oldEstimate,'date')+check('dateConfirmed','交付日期已确认',oldConfirmed)+expected+reasonField('调整理由')+actorField(),form=>{
      const patch={estimatedDate:String(form.get('estimatedDate')||''),targetDate:String(form.get('targetDate')||''),dateConfirmed:form.has('dateConfirmed')};
      const needsReason=tracked&&(patch.estimatedDate!==oldEstimate||(oldConfirmed&&!patch.dateConfirmed));
      if(needsReason&&!String(form.get('deliveryReason')||'').trim())throw Error('请填写调整理由，再保存交付日期。');
      return submit(pid,nid,patch,form,'交付日期已更新');
    },'保存日期');
    bindForm({reasonRequired:host=>tracked&&(host.querySelector('[name="estimatedDate"]').value!==oldEstimate||(oldConfirmed&&!host.querySelector('[name="dateConfirmed"]').checked))});
    return true;
  }
  function complete(pid,nid) {
    if(!start())return false;const found=locate(pid,nid);if(!found)return false;
    const {project,node}=found,state=deliveryState(project,node),existing=state.completedAt||'',completed=state.kind==='delivered';
    const details=context(project,node)+(state.date?'<p class="delivery-previous-date">承诺交付日 <strong><time>'+esc(state.date)+'</time></strong></p>':'');
    editor(completed?'更正交付记录':'记录已交付',details+field('completedAt','实际交付日期',existing||todayDate(),'date','required max="'+todayDate()+'"')+area('deliveryReason',completed?'更正理由':'交付说明（选填）','',3)+actorField(),form=>{
      const date=String(form.get('completedAt')||'');if(!date)throw Error('请填写实际交付日期。');
      if(completed&&date!==existing&&!String(form.get('deliveryReason')||'').trim())throw Error('请填写更正交付记录的理由。');
      return submit(pid,nid,{completedAt:date},form,'已记录交付，历史保留');
    },completed?'保存更正':'记录交付');
    if(completed){const input=document.getElementById('editorFields')?.querySelector('[name="deliveryReason"]');if(input){input.required=true;input.setAttribute('aria-required','true');}}
    return true;
  }
  function reopen(pid,nid) {
    if(!start())return false;const found=locate(pid,nid);if(!found)return false;
    editor('恢复跟进',context(found.project,found.node)+reasonField('恢复跟进的理由')+actorField(),form=>{
      if(!String(form.get('deliveryReason')||'').trim())throw Error('请填写恢复跟进的理由。');
      return submit(pid,nid,{completedAt:''},form,'已恢复跟进，原交付记录保留');
    },'恢复跟进');bindForm({always:true});return true;
  }
  function removeNode(pid,nid) {
    if(!start())return false;const found=locate(pid,nid);if(!found)return false;
    if(!isTracked(found.project,found.node))return mutate(()=>removeDeliveryNode(getState(),pid,nid),'计划已移除，可撤销',{rollbackOnSaveFailure:true});
    editor('移除交付计划',context(found.project,found.node)+'<p class="muted">移除后，已有的交付日期和调整记录仍会保留。</p>'+reasonField('移除理由')+actorField(),form=>{
      if(flush()===false)return false;
      const reason=String(form.get('deliveryReason')||'').trim(),recordActor=String(form.get('deliveryActor')||'').trim();
      if(!reason)throw Error('请填写移除理由。');
      const ok=mutate(()=>removeDeliveryNode(getState(),pid,nid,{reason,actor:recordActor}),'计划已移除，记录保留',{rollbackOnSaveFailure:true});
      if(ok!==false)rememberActor(recordActor);return ok;
    },'移除计划');bindForm({always:true});return true;
  }
  function deleteProject(pid,onRemove) {
    if(!start())return false;const project=getState().projects.find(item=>item.id===pid);if(!project){toast('项目已不存在');return false;}
    const tracked=project.planNodes.some(node=>isTracked(project,node))||(getState().deliveryEvents||[]).some(event=>event.projectId===pid);
    editor('删除项目','<p>删除「'+esc(project.name)+'」及它的画板引用、主小关联。关联的其他项目保留，可立即撤销。</p>'+(tracked?'<p class="muted">已有交付记录会继续留存在延期记录页。</p>'+reasonField('删除理由')+actorField():''),form=>{
      if(flush()===false)return false;const reason=String(form.get('deliveryReason')||'').trim(),recordActor=String(form.get('deliveryActor')||'').trim();
      if(tracked&&!reason)throw Error('请填写删除理由。');
      const ok=mutate(()=>{
        const current=getState().projects.find(item=>item.id===pid);if(!current)throw Error('项目已不存在');
        for(const node of [...current.planNodes])removeDeliveryNode(getState(),pid,node.id,{reason,actor:recordActor});
        onRemove(pid);
      },tracked?'项目已删除，交付记录保留':'项目已删除，可撤销',{rollbackOnSaveFailure:true});
      if(ok!==false&&tracked)rememberActor(recordActor);return ok;
    },'删除项目');if(tracked)bindForm({always:true});return true;
  }
  return {edit,complete,reopen,removeNode,deleteProject};
}
