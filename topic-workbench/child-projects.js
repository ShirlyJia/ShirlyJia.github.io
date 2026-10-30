import {readProjectFlow,setCurrentFlowNode} from './project-flow.js';
import {isClosedProject} from './workbench-model.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const treeIcon='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="7.5" y="2" width="5" height="4" rx="1"/><path d="M10 6v4M4 13v-3h12v3"/><rect x="1.5" y="13" width="5" height="4" rx="1"/><rect x="13.5" y="13" width="5" height="4" rx="1"/></svg>';
const parentIcon='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12H8a3 3 0 0 1-3-3V3m-3 3 3-3 3 3"/></svg>';

/** The badge carries relationship metadata without using preview text space. */
export function childBadgeMarkup(count,pid,{readonly=false,expandable=false,expanded=false}={}){
  if(!Number.isInteger(count)||count<0||(!count&&!expandable))return '';
  if(expandable){
    const label=(expanded?'收起':'展开')+'小项目'+(count?'（'+count+'）':''),content='<svg class="child-tree-chevron'+(expanded?' is-expanded':'')+'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>'+(count?'<span class="child-project-count">'+(count>99?'99+':count)+'</span>':'');
    return readonly?'<span class="child-project-badge" title="'+count+' 个小项目">'+content+'</span>':'<button type="button" class="child-project-badge" data-toggle-children="'+esc(pid)+'" aria-expanded="'+expanded+'" aria-label="'+label+'" title="'+label+'">'+content+'</button>';
  }
  const label=count+' 个小项目',content=treeIcon+'<span class="child-project-count">'+(count>99?'99+':count)+'</span>';
  return readonly?'<span class="child-project-badge" title="'+label+'" aria-label="'+label+'">'+content+'</span>':'<button type="button" class="child-project-badge" data-open-children="'+esc(pid)+'" aria-label="查看'+label+'" title="'+label+'">'+content+'</button>';
}

/** Direct children are a view over shared facts, including completed projects. */
export function childProjectRows(pid,data){
  const projects=new Map((data.projects||[]).map(project=>[project.id,project])),children=new Map();
  for(const relation of data.relations||[]){
    if(relation.main!==pid||relation.child===pid||!projects.has(relation.child))continue;
    const previous=children.get(relation.child);
    children.set(relation.child,{project:projects.get(relation.child),draft:!!relation.draft&&(!previous||previous.draft)});
  }
  return [...children.values()];
}

export function childTreeMarkup(children,{readonly=false}={}){
  if(!children.length)return readonly?'':'<div class="child-project-tree"><button type="button" class="child-tree-add" data-tree-add>＋ 添加小项目</button></div>';
  return '<ul class="child-project-tree" aria-label="关联小项目">'+children.map(({project,draft})=>{
    const closed=isClosedProject(project),label=project.name+(closed?' · 已结束':'')+(draft?' · 关联待确认':'');
    const attributes='class="child-tree-link" data-project-highlight="'+esc(project.id)+'" title="'+esc(label)+'" aria-label="'+esc(label)+'"';
    const content='<span class="child-tree-dot" aria-hidden="true"></span><span class="child-tree-title">'+esc(project.name)+'</span>'+(closed?'<small>已结束</small>':'');
    return '<li'+(draft?' class="is-draft"':'')+'>'+(readonly?'<span role="button" tabindex="0" data-pid="'+esc(project.id)+'" '+attributes+'>'+content+'</span>':'<button type="button" data-tree-project="'+esc(project.id)+'" '+attributes+'>'+content+'</button>')+'</li>';
  }).join('')+'</ul>';
}

export function childSectionActionsMarkup(){
  return '<div class="child-project-actions"><button type="button" class="text-action" data-action="child-create">＋ 新建小项目</button><button type="button" class="text-action" data-action="relation-add-main">关联已有项目</button></div>';
}

export function parentProjectRows(pid,data){
  const projects=new Map((data.projects||[]).map(project=>[project.id,project])),parents=new Map();
  for(const relation of data.relations||[]){
    if(relation.child!==pid||relation.main===pid||!projects.has(relation.main))continue;
    const previous=parents.get(relation.main);
    parents.set(relation.main,{project:projects.get(relation.main),draft:!!relation.draft&&(!previous||previous.draft)});
  }
  return [...parents.values()];
}

/** Direct parents are navigation hints; they do not create another project tag. */
export function parentProjectHintMarkup(pid,data){
  const parents=parentProjectRows(pid,data);if(!parents.length)return '';
  return '<nav class="project-parent-hint" aria-label="所属主项目"><span class="parent-hint-label">'+treeIcon+'主项目</span>'+parents.map(({project,draft})=>'<button type="button" class="parent-project-link" data-related="'+esc(project.id)+'" title="'+esc(project.name)+(draft?' · 关联待确认':'')+'" aria-label="查看主项目：'+esc(project.name)+'"><span>'+esc(project.name)+'</span>'+(draft?'<small>待确认</small>':'')+'</button>').join('')+'</nav>';
}

/** A compact breadcrumb on every child card; full names stay available on hover. */
export function parentCardMarkup(pid,data,{readonly=false}={}){
  const parents=parentProjectRows(pid,data);if(!parents.length)return '';
  const first=parents[0],label='所属主项目：'+parents.map(({project,draft})=>project.name+(draft?'（关联待确认）':'')).join('、');
  const content=parentIcon+'<span class="card-parent-label">主项目</span><span class="card-parent-name">'+esc(first.project.name)+'</span>'+(parents.length>1?'<small class="card-parent-count">+'+(parents.length-1)+'</small>':first.draft?'<small>待确认</small>':'');
  const attributes='title="'+esc(label)+'" aria-label="'+esc(label)+'"';
  if(readonly)return '<div class="card-parent-marker"><span class="card-parent-trigger" '+attributes+'>'+content+'</span></div>';
  if(parents.length===1)return '<div class="card-parent-marker"><button type="button" class="card-parent-trigger" data-card-parent="'+esc(first.project.id)+'" '+attributes+'>'+content+'</button></div>';
  return '<div class="detail-menu card-parent-marker"><button type="button" class="menu-trigger card-parent-trigger" aria-expanded="false" '+attributes+'>'+content+'</button><div class="detail-menu-content card-parent-menu" aria-label="所属主项目">'+parents.map(({project,draft})=>'<button type="button" class="text-action" data-card-parent="'+esc(project.id)+'" title="'+esc(project.name)+'"><span>'+esc(project.name)+'</span>'+(draft?'<small>待确认</small>':'')+'</button>').join('')+'</div></div>';
}

function text(value,label,{required=false,max=Infinity}={}){
  if(typeof value!=='string')throw Error(label+'必须是文字');
  const result=value.trim();if(required&&!result)throw Error(label+'不能为空');if(result.length>max)throw Error(label+'过长');return result;
}
function documentLists(data){
  if(!data||!Array.isArray(data.projects)||!Array.isArray(data.relations))throw Error('项目或关联记录无效');
}

/** A relation references the existing fact record; linking never copies a project. */
export function createChildRelation(data,parentId,childId,{id,context='',richContext=''}={}){
  documentLists(data);text(id,'关联标识',{required:true});
  if(parentId===childId)throw Error('项目不能关联自身');
  if(!data.projects.some(p=>p.id===parentId)||!data.projects.some(p=>p.id===childId))throw Error('关联项目不存在');
  if(data.relations.some(r=>r.id===id))throw Error('关联标识重复');
  if(data.relations.some(r=>r.main===parentId&&r.child===childId))throw Error('这两个项目已有关联');
  if(typeof richContext!=='string')throw Error('关联说明格式无效');
  return {id,main:parentId,child:childId,context:text(context,'关联说明'),richText:{context:richContext},draft:false};
}

/** Build both records before a caller commits them together. No input is mutated. */
export function createChildProject(data,parentId,{id,relationId,name,description='',richDescription='',priority='',context='',richContext=''}={}){
  documentLists(data);text(id,'项目标识',{required:true});
  if(!data.projects.some(p=>p.id===parentId))throw Error('所属主项目不存在');
  if(data.projects.some(p=>p.id===id))throw Error('项目标识重复');
  if(typeof richDescription!=='string')throw Error('问题陈述格式无效');
  const project={id,name:text(name,'标题',{required:true,max:180}),kind:'project',priority:text(priority,'优先级'),description:text(description,'问题陈述'),richText:{description:richDescription},status:'',summary:'',result:'',impact:'',closed:false,closedAt:'',outcome:'',comments:[],customSections:[],tagIds:[],planNodes:[],materials:[]};
  project.flow=readProjectFlow(project);setCurrentFlowNode(project,'start');
  const relation=createChildRelation({...data,projects:[...data.projects,project]},parentId,id,{id:relationId,context,richContext});
  return {project,relation};
}
