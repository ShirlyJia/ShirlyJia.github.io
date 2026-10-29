/** One project can have several canvas placements, each with its own local notes. */
const escapeAttribute=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const point=box=>({x:box.x+box.w/2,y:box.y+box.h/2});
const validBox=box=>box&&[box.x,box.y,box.w,box.h,box.x+box.w,box.y+box.h].every(Number.isFinite)&&box.w>0&&box.h>0;
const number=value=>Number(value.toFixed(3));

export function referenceCurve(a,b){
  if(!validBox(a)||!validBox(b))return '';
  const ac=point(a),bc=point(b),horizontal=Math.abs(bc.x-ac.x)>=Math.abs(bc.y-ac.y);
  if(horizontal){
    const direction=bc.x>=ac.x?1:-1,x1=direction>0?a.x+a.w:a.x,x2=direction>0?b.x:b.x+b.w;
    const bend=Math.max(36,Math.min(240,Math.abs(x2-x1)*.45));
    return `M ${number(x1)} ${number(ac.y)} C ${number(x1+direction*bend)} ${number(ac.y)}, ${number(x2-direction*bend)} ${number(bc.y)}, ${number(x2)} ${number(bc.y)}`;
  }
  const direction=bc.y>=ac.y?1:-1,y1=direction>0?a.y+a.h:a.y,y2=direction>0?b.y:b.y+b.h;
  const bend=Math.max(36,Math.min(240,Math.abs(y2-y1)*.45));
  return `M ${number(ac.x)} ${number(y1)} C ${number(ac.x)} ${number(y1+direction*bend)}, ${number(bc.x)} ${number(y2-direction*bend)}, ${number(bc.x)} ${number(y2)}`;
}

/** Bounds are in world coordinates, measured from rendered cards by the caller. */
export function referenceConnections(instances,frames,boundsById){
  const bounds=id=>boundsById instanceof Map?boundsById.get(id):boundsById?.[id];
  const memberships=new Map();
  for(const frame of frames||[])for(const id of frame.members||[]){
    if(!memberships.has(id))memberships.set(id,new Set());
    memberships.get(id).add(frame.id);
  }
  const projects=new Map(),seen=new Set();
  for(const instance of instances||[]){
    if(!instance?.id||!instance.pid||seen.has(instance.id)||!validBox(bounds(instance.id)))continue;
    seen.add(instance.id);
    const group=JSON.stringify([...(memberships.get(instance.id)||[])].sort());
    if(!projects.has(instance.pid))projects.set(instance.pid,[]);
    projects.get(instance.pid).push({id:instance.id,group,box:bounds(instance.id)});
  }
  const result=[];
  for(const [pid,placements] of projects){
    if(placements.length<2)continue;
    const groups=[...new Set(placements.map(i=>i.group))];
    if(groups.length<2)continue;
    const parent=new Map(groups.map(g=>[g,g]));
    const root=group=>{while(parent.get(group)!==group)group=parent.get(group);return group;};
    const candidates=[];
    for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
      const a=placements[i],b=placements[j];if(a.group===b.group)continue;
      const ac=point(a.box),bc=point(b.box);
      candidates.push({a,b,distance:Math.hypot(ac.x-bc.x,ac.y-bc.y)});
    }
    candidates.sort((a,b)=>a.distance-b.distance||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id));
    let remaining=groups.length-1;
    for(const {a,b} of candidates){
      const ar=root(a.group),br=root(b.group);if(ar===br)continue;
      parent.set(ar,br);
      result.push({pid,from:a.id,to:b.id,path:referenceCurve(a.box,b.box)});
      if(!--remaining)break;
    }
  }
  return result;
}

/** Put this layer after frames and before cards. Paths never intercept canvas input. */
export function referenceLinesMarkup(instances,frames,boundsById,{activePid=null,dimmedPids=[]}={}){
  const dimmed=new Set(dimmedPids),connections=referenceConnections(instances,frames,boundsById);
  return '<svg class="canvas-reference-lines" width="1" height="1" aria-hidden="true" focusable="false">'+connections.map(line=>
    '<path class="canvas-reference-line'+(line.pid===activePid?' is-active':'')+(dimmed.has(line.pid)?' is-dimmed':'')+'" data-reference-pid="'+escapeAttribute(line.pid)+'" data-reference-from="'+escapeAttribute(line.from)+'" data-reference-to="'+escapeAttribute(line.to)+'" d="'+line.path+'" vector-effect="non-scaling-stroke"></path>'
  ).join('')+'</svg>';
}

/** Copy the placement, not the project. The same pid keeps project facts shared. */
export function clonePlacement(instance,{id,x,y,offset=36,placements=[]}={}){
  if(!instance?.pid||!instance.id||!id||typeof id!=='string'||id===instance.id||placements.some(row=>row.id===id))throw Error('请为画板副本使用新的标识');
  if(!Number.isFinite(instance.x)||!Number.isFinite(instance.y)||!Number.isFinite(offset)||offset<=0)throw Error('无效的画板位置');
  if((x!==undefined&&!Number.isFinite(x))||(y!==undefined&&!Number.isFinite(y)))throw Error('无效的画板位置');
  const copy=structuredClone(instance);
  copy.id=id;copy.x=x??instance.x+offset;copy.y=y??instance.y+offset;
  if(x===undefined&&y===undefined){
    for(let i=0;i<placements.length&&placements.some(row=>Math.abs(row.x-copy.x)<16&&Math.abs(row.y-copy.y)<16);i++){
      copy.x+=offset;copy.y+=offset;
    }
  }
  return copy;
}
