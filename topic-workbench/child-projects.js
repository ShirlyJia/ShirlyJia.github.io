import {readProjectFlow,setCurrentFlowNode} from './project-flow.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const treeIcon='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="7.5" y="2" width="5" height="4" rx="1"/><path d="M10 6v4M4 13v-3h12v3"/><rect x="1.5" y="13" width="5" height="4" rx="1"/><rect x="13.5" y="13" width="5" height="4" rx="1"/></svg>';

/** The badge carries relationship metadata without using preview text space. */
export function childBadgeMarkup(count,pid,{readonly=false}={}){
  if(!Number.isInteger(count)||count<1)return '';
  const label=count+' 个小项目',content=treeIcon+'<span class="child-project-count">'+(count>99?'99+':count)+'</span>';
  return readonly?'<span class="child-project-badge" title="'+label+'" aria-label="'+label+'">'+content+'</span>':'<button type="button" class="child-project-badge" data-open-children="'+esc(pid)+'" aria-label="查看'+label+'" title="'+label+'">'+content+'</button>';
}

export function childSectionActionsMarkup(){
  return '<div class="child-project-actions"><button type="button" class="text-action" data-action="child-create">＋ 新建小项目</button><button type="button" class="text-action" data-action="relation-add-main">关联已有项目</button></div>';
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
