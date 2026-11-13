import {freezeCommentOptions} from './frozen-note.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';

export function freezeCommentPickerMarkup(projectId) {
  return projectId?'<details class="freeze-comment-picker" data-freeze-comment-picker="'+esc(projectId)+'"><summary>选择已有评论</summary><div class="freeze-comment-options" aria-live="polite"></div></details>':'';
}

export function mountFreezeCommentPickers(root,{getProject,loadRecords,onChoose}) {
  root.querySelectorAll('[data-freeze-comment-picker]').forEach(picker=>{
    const projectId=picker.dataset.freezeCommentPicker,body=picker.querySelector('.freeze-comment-options');
    let options=[],request=0;
    const current=version=>version===request&&picker.isConnected&&picker.open;
    function render({loading=false,error=false}={}) {
      body.innerHTML=(loading?'<p class="freeze-comment-status">正在读取留言…</p>':'')+(error?'<p class="freeze-comment-status">飞书留言暂时无法读取 <button type="button" data-freeze-comment-retry>重试</button></p>':'')+
        options.map(option=>'<button type="button" class="freeze-comment-option" data-freeze-comment="'+esc(option.id)+'"><span class="freeze-comment-heading"><strong>'+esc(option.title)+'</strong><small>'+esc(option.author)+(date(option.createdAt)?' <time datetime="'+esc(option.createdAt)+'">'+date(option.createdAt)+'</time>':'')+'</small></span><span class="freeze-comment-preview">'+esc(option.text||'图片记录')+'</span></button>').join('')+
        (!loading&&!options.length?'<p class="freeze-comment-status">暂无可选评论，可直接填写冻结原因。</p>':'');
    }
    async function load() {
      const version=++request;
      options=freezeCommentOptions(getProject(projectId));render({loading:Boolean(loadRecords)});
      if(!loadRecords)return;
      try {
        const records=await loadRecords(projectId);
        if(!current(version))return;
        options=freezeCommentOptions(getProject(projectId),records);render();
      } catch {
        if(current(version))render({error:true});
      }
    }
    picker.addEventListener('toggle',()=>{if(picker.open)load();else request++;});
    body.addEventListener('click',event=>{
      if(event.target.closest('[data-freeze-comment-retry]')){load();return;}
      const button=event.target.closest('[data-freeze-comment]');if(!button)return;
      const option=options.find(row=>row.id===button.dataset.freezeComment);if(!option)return;
      if(onChoose(option,picker)===false)return;
      picker.open=false;
    });
  });
}
