import {isClosedProject,sortProjectsByPriority} from './workbench-model.js';

export const directionIcon='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><path d="M4.5 7v8h8M4.5 10h8"/><rect x="13" y="7.5" width="5" height="5" rx="1"/><rect x="13" y="14" width="5" height="4" rx="1"/></svg>';

/** A temporary view over shared relations. Never copy facts or move placements. */
export function directionFocusModel(data,id){
  const projects=new Map((data.projects||[]).map(p=>[p.id,p])),direction=projects.get(id);
  if(direction?.kind!=='direction')return null;
  const edges=new Map();
  for(const relation of data.relations||[]){
    if(relation.main===relation.child||!projects.has(relation.main)||!projects.has(relation.child))continue;
    if(!edges.has(relation.main))edges.set(relation.main,[]);
    edges.get(relation.main).push(relation);
  }
  function walk(confirmedOnly){
    const found=new Map([[id,{project:direction,depth:0}]]),queue=[id];
    for(let i=0;i<queue.length;i++)for(const relation of edges.get(queue[i])||[]){
      if(confirmedOnly&&relation.draft||found.has(relation.child))continue;
      const row={project:projects.get(relation.child),parent:projects.get(relation.main),relation,depth:found.get(relation.main).depth+1};
      found.set(relation.child,row);queue.push(relation.child);
    }
    return found;
  }
  const all=walk(false),confirmed=walk(true),children=new Map();
  for(const [pid,anyPath] of all){
    if(pid===id)continue;
    const row={...(confirmed.get(pid)||anyPath),draft:!confirmed.has(pid)};
    if(!children.has(row.parent.id))children.set(row.parent.id,[]);
    children.get(row.parent.id).push(row);
  }
  const rows=[],visited=new Set([id]);
  function append(parent){
    const siblings=children.get(parent)||[],byId=new Map(siblings.map(r=>[r.project.id,r]));
    for(const project of sortProjectsByPriority(siblings.map(r=>r.project))){
      if(visited.has(project.id))continue;
      visited.add(project.id);const row=byId.get(project.id);rows.push(row);append(project.id);
    }
  }
  append(id);
  return {direction,ids:new Set(all.keys()),rows,active:rows.filter(r=>!isClosedProject(r.project)),closed:rows.filter(r=>isClosedProject(r.project))};
}
