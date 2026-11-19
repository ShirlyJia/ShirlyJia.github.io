import {projectLifecycle,lifecycleLabels} from './project-lifecycle.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tree='<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="6.5" y="2" width="5" height="4" rx="1"/><path d="M9 6v4m-5 3v-3h10v3"/><rect x="2" y="13" width="4" height="3" rx="1"/><rect x="12" y="13" width="4" height="3" rx="1"/></svg>';
const dots='<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.35"/><circle cx="10" cy="10" r="1.35"/><circle cx="16" cy="10" r="1.35"/></svg>';
const chevron='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
const row=(label,attrs,{end='',className=''}={})=>'<button type="button" class="detail-nav-row '+className+'" '+attrs+'><span>'+esc(label)+'</span>'+end+'</button>';
const action=(label,key,id='')=>row(label,'data-action="'+key+'" data-id="'+esc(id)+'"');
const jump=(label,key,end='')=>row(label,'data-detail-jump="'+key+'"',{end});
const group=(label,items)=>items?'<div class="detail-nav-group"><div class="detail-nav-label">'+label+'</div>'+items+'</div>':'';
const menu=(id,label,trigger,body)=>'<div class="detail-popover"><button type="button" class="detail-popover-trigger" aria-expanded="false" aria-controls="'+id+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+trigger+'</button><div id="'+id+'" class="detail-popover-panel" role="group" aria-label="'+esc(label)+'" hidden>'+body+'</div></div>';

export function detailNavigationMarkup({children,maintainer,sectionKeys,planCount,materialCount,canLocate,locationLabel,placement,restoreMarkup=''}) {
  const count=children.length;
  const childRows=children.map(({project,draft})=>{
    const status=projectLifecycle(project);
    const badge=status==='active'?'':'<small class="detail-nav-status '+esc(status)+'">'+esc(lifecycleLabels[status])+'</small>';
    return row(project.name,'data-related="'+esc(project.id)+'" title="'+esc(project.name)+'"',{end:(draft?'<small>待确认</small>':'')+badge+'<span class="detail-nav-arrow" aria-hidden="true">›</span>',className:'detail-nav-project'});
  }).join('');
  const childMenu=count||maintainer?menu('detailChildrenMenu',count?'小项目（'+count+'）':'添加小项目',
    tree+'<span>小项目</span>'+(count?'<small>'+count+'</small>'+chevron:'<span aria-hidden="true">＋</span>'),
    '<div class="detail-nav-label">'+(count?'关联项目 · '+count:'关联项目')+'</div>'+
    (count?'<div class="detail-nav-projects">'+childRows+'</div>':'<p class="detail-nav-empty">还没有小项目</p>')+
    (count&&sectionKeys.includes('children')?'<div class="detail-nav-group">'+jump('查看关联说明','children','<small aria-hidden="true">↓</small>')+'</div>':'')+
    (maintainer?'<div class="detail-nav-group">'+action('新建小项目','child-create')+action('关联已有项目','relation-add-main')+'</div>':'')):'';
  const countEnd=n=>'<small>'+n+' 项 ↓</small>';
  const shortcuts=(planCount&&sectionKeys.includes('plans')?jump('查看计划','plans',countEnd(planCount)):'')+
    (materialCount&&sectionKeys.includes('materials')?jump('查看资料','materials',countEnd(materialCount)):'');
  const board=(canLocate?row(locationLabel,'data-locate-detail-project'):'')+
    (maintainer?action('添加到画板分组','reference')+(placement?action('编辑此处备注与重点','placement',placement.id):''):'');
  const more=group('查看栏目',shortcuts)+
    (maintainer?group('添加内容',action('新增栏目','section-add')+action('新增计划','inline-node-add')+action('添加资料链接','material-add'))+
    group('项目关系',action('关联主项目','relation-add-child')):'')+
    group('画板与列表',board)+
    (maintainer?restoreMarkup+'<div class="detail-nav-group detail-nav-danger">'+row('删除项目','data-action="project-delete"')+'</div>':'');
  return '<div class="detail-navigation">'+childMenu+(more?menu('detailMoreMenu','更多项目操作',dots,more):'')+'</div>';
}

export function bindDetailNavigation(root) {
  let open=null, pinned=false, timer;
  const trigger=entry=>entry.querySelector('.detail-popover-trigger');
  const panel=entry=>entry.querySelector('.detail-popover-panel');
  const close=(restore=false)=>{
    clearTimeout(timer);
    if(!open)return;
    const entry=open;open=null;pinned=false;
    trigger(entry).setAttribute('aria-expanded','false');
    panel(entry).hidden=true;
    if(restore&&entry.isConnected)trigger(entry).focus({preventScroll:true});
  };
  const show=(entry,lock=false)=>{
    clearTimeout(timer);
    if(open!==entry){close();open=entry;}
    pinned=lock;
    trigger(entry).setAttribute('aria-expanded','true');
    panel(entry).hidden=false;
  };
  root.addEventListener('pointerover',event=>{
    if(event.pointerType!=='mouse')return;
    const entry=event.target.closest('.detail-popover');
    if(!entry)return;
    clearTimeout(timer);
    if(!pinned&&open!==entry&&(!open||!panel(open).contains(document.activeElement)))show(entry);
  });
  root.addEventListener('pointerout',event=>{
    if(pinned||event.pointerType!=='mouse'||!open?.contains(event.target)||open.contains(event.relatedTarget))return;
    clearTimeout(timer);
    timer=setTimeout(()=>{if(open&&!pinned&&!panel(open).contains(document.activeElement))close();},160);
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('.detail-popover-trigger');
    if(button){
      const entry=button.closest('.detail-popover');
      if(open===entry&&pinned){close();return;}
      show(entry,true);
      if(event.detail===0)panel(entry).querySelector('button')?.focus({preventScroll:true});
      return;
    }
    if(open&&event.target.closest('.detail-popover-panel button')&&open.contains(event.target))close(true);
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&open?.isConnected){event.preventDefault();event.stopPropagation();close(true);}
  });
  root.addEventListener('focusout',event=>{
    if(open?.contains(event.target)&&event.relatedTarget&&!open.contains(event.relatedTarget)&&!open.matches(':hover'))close();
  });
  document.addEventListener('pointerdown',event=>{if(open&&!open.contains(event.target))close();},true);
}
