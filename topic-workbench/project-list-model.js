import {isClosedProject} from './workbench-model.js';
import {displayPriority} from './presentation.js';
import {deliveryState} from './delivery-model.js';

export const UNGROUPED = '__ungrouped__';
export const NO_PRIORITY = '__no_priority__';
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id=>typeof id==='string'))] : [];
const position = (a,b) => (a.y||0)-(b.y||0)||(a.x||0)-(b.x||0);
const rankBy = order => new Map(order.map((id,index)=>[id,index]));
export function listPreferences(value={}) {
  const input=value&&typeof value==='object'?value:{};
  return {groupId:typeof input.groupId==='string'?input.groupId:'',priority:typeof input.priority==='string'?input.priority:'',
    sort:['canvas','manual','priority','delivery','name'].includes(input.sort)?input.sort:'canvas',descending:input.descending===true,
    groupOrder:ids(input.groupOrder),projectOrder:Object.fromEntries(Object.entries(input.projectOrder||{}).map(([id,order])=>[id,ids(order)])),collapsed:ids(input.collapsed)};
}
export function priorityRank(value) {
  const priority=displayPriority({priority:value});
  return !priority?null:/^P\d+$/i.test(priority)?Number(priority.slice(1)):priority==='长期'?1000:2000;
}
export function committedDate(project) {
  return (project.planNodes||[]).map(node=>deliveryState(project,node)).filter(state=>['overdue','due','scheduled'].includes(state.kind)&&state.date).map(state=>state.date).sort()[0]||null;
}
function compareOptional(a,b,descending) {
  if(a===null)return b===null?0:1;
  if(b===null)return -1;
  const result=typeof a==='number'?a-b:a.localeCompare(b,'zh-CN',{numeric:true});
  return descending?-result:result;
}
/** Frame membership stays live. Repeated placements collapse only within a group. */
export function projectListGroups(data,options={}) {
  const prefs=listPreferences(options),projects=(data.projects||[]).filter(p=>!isClosedProject(p)),byId=new Map(projects.map(p=>[p.id,p]));
  const placements=new Map((data.instances||[]).map(i=>[i.id,i])),assigned=new Set();
  const groups=[...(data.frames||[])].sort(position).map(frame=>{
    const members=(frame.members||[]).map(id=>placements.get(id)).filter(i=>i&&byId.has(i.pid)).sort(position),seen=new Set();
    const rows=members.filter(i=>{if(seen.has(i.pid))return false;seen.add(i.pid);assigned.add(i.pid);return true;}).map(i=>({project:byId.get(i.pid),instance:i}));
    return {id:frame.id,name:frame.name,color:frame.color||'#8c8981',frame,rows};
  });
  const loose=projects.filter(p=>!assigned.has(p.id)).map(project=>({project,instance:(data.instances||[]).filter(i=>i.pid===project.id).sort(position)[0]||null}));
  if(loose.length)groups.push({id:UNGROUPED,name:'未分组',color:'#a6a39a',rows:loose});
  if(prefs.sort==='manual'){
    const ranks=rankBy(prefs.groupOrder);
    groups.sort((a,b)=>a.id===UNGROUPED?1:b.id===UNGROUPED?-1:(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));
  }
  for(const group of groups){
    if(prefs.sort==='manual'){
      const ranks=rankBy(prefs.projectOrder[group.id]||[]);
      group.rows.sort((a,b)=>(ranks.get(a.project.id)??Infinity)-(ranks.get(b.project.id)??Infinity));
    }else if(['priority','delivery','name'].includes(prefs.sort)){
      const value=p=>prefs.sort==='priority'?priorityRank(p.priority):prefs.sort==='delivery'?committedDate(p):p.name||null;
      const values=new Map(group.rows.map(row=>[row.project.id,value(row.project)]));
      group.rows.sort((a,b)=>compareOptional(values.get(a.project.id),values.get(b.project.id),prefs.descending));
    }
  }
  return groups;
}
export function matchesListFilters(project,data,prefs) {
  const priority=displayPriority(project);
  if(prefs.priority&&(prefs.priority===NO_PRIORITY?!!priority:priority!==prefs.priority))return false;
  if(!prefs.groupId)return true;
  const placements=new Set((data.instances||[]).filter(i=>i.pid===project.id).map(i=>i.id));
  if(prefs.groupId===UNGROUPED)return !(data.frames||[]).some(f=>(f.members||[]).some(id=>placements.has(id)));
  const frame=(data.frames||[]).find(f=>f.id===prefs.groupId);
  return !frame||(frame.members||[]).some(id=>placements.has(id));
}
/** Reorder the full sequence so filtered-out projects are never lost. */
export function moveListId(order,id,target,side='before') {
  if(id===target||!order.includes(id)||!order.includes(target))return [...order];
  const next=order.filter(value=>value!==id);next.splice(next.indexOf(target)+(side==='after'?1:0),0,id);return next;
}
