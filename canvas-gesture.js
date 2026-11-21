import {canvasItemBounds} from './canvas-items.js';

const finite=value=>Number.isFinite(value)?value:0;
const clone=value=>structuredClone(value);
const validBox=box=>box&&[box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>=0&&box.h>=0;
// Translating two flush edges at fractional zoom can round them a fraction of a pixel apart.
const edgeTolerance=1e-7;
const contains=(outer,inner)=>validBox(outer)&&validBox(inner)&&
  inner.x>=outer.x-edgeTolerance && inner.y>=outer.y-edgeTolerance &&
  inner.x+inner.w<=outer.x+outer.w+edgeTolerance && inner.y+inner.h<=outer.y+outer.h+edgeTolerance;
export function frameContainsCard(frame,box) {
  if(!box)return false;
  return contains(frame,{x:box.x+box.w/2,y:box.y+box.h/2,w:0,h:0});
}

/** Normalize wheel input to screen pixels before the view or world coordinates change. */
export function wheelDelta(event,{width=0,height=0,lineHeight=16}={}) {
  let dx=finite(event?.deltaX),dy=finite(event?.deltaY);
  // Some browsers already translate Shift + wheel into a horizontal delta.
  if(event?.shiftKey && !event.ctrlKey && !event.metaKey && !dx) {
    dx=dy;
    dy=0;
  }
  if(event?.deltaMode===1){const unit=Math.max(0,finite(lineHeight));return{x:dx*unit,y:dy*unit};}
  if(event?.deltaMode===2)return{x:dx*Math.max(0,finite(width)),y:dy*Math.max(0,finite(height))};
  return {x:dx,y:dy};
}

/** Center the visible content, leaving space for the navigation and drawing tools. */
export function centeredCanvasView(boxes, width, height, {maxScale=1,readingTargets=[]}={}) {
  if (width<=0 || height<=0) return null;
  if (!boxes.length) return {x:width/2, y:height/2, z:1};
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for (const box of boxes) {
    left=Math.min(left,box.x);
    top=Math.min(top,box.y);
    right=Math.max(right,box.x+box.w);
    bottom=Math.max(bottom,box.y+box.h);
  }
  const padX=Math.min(32,width*.08), padY=Math.min(62,height*.18);
  const fitScale=(w,h) => Math.min(maxScale,(width-2*padX)/Math.max(1,w),(height-2*padY)/Math.max(1,h));
  let z=fitScale(right-left,bottom-top);
  let centerX=(left+right)/2, centerY=(top+bottom)/2;
  if (z < .75 && readingTargets.length) {
    // On a large board the geometric center may be an empty gap.
    let nearest=readingTargets[0], distance=Infinity;
    for (const target of readingTargets) {
      const dx=target.x+target.w/2-centerX, dy=target.y+target.h/2-centerY;
      const squared=dx*dx+dy*dy;
      if (squared<distance) { nearest=target; distance=squared; }
    }
    centerX=nearest.x+nearest.w/2;
    centerY=nearest.y+nearest.h/2;
    z=fitScale(nearest.w,nearest.h);
  }
  return {x:width/2-centerX*z, y:height/2-centerY*z, z};
}

/** Crossing a frame does not select the entire group; a marquee must enclose its body. */
export function enclosedFrameIds(frames,bounds) {
  if(!validBox(bounds))return[];
  return (frames||[]).filter(frame=>contains(bounds,frame)).map(frame=>frame.id);
}

/** Capture at pointerdown. Every nested body is contained by a root, regardless of depth or layer order. */
export function moveSelection(state,{instanceId,frameId,cardBounds}={}) {
  const frameIds=new Set(state.selectedFrames||[]),instanceIds=new Set(state.selected||[]);
  if(frameId)frameIds.add(frameId);if(instanceId)instanceIds.add(instanceId);
  const allFrames=state.frames||[];
  const roots=allFrames.filter(frame=>frameIds.has(frame.id));
  const frames=allFrames.filter(frame=>frameIds.has(frame.id)||roots.some(root=>
    (root.w-frame.w>edgeTolerance || root.h-frame.h>edgeTolerance) && contains(root,frame)));
  for(const frame of frames)for(const id of frame.members||[])instanceIds.add(id);
  const items=(state.instances||[]).filter(instance=>{
    if(instanceIds.has(instance.id))return true;
    if(!roots.length||!cardBounds)return false;
    const bounds=cardBounds(instance);
    return roots.some(frame=>frameContainsCard(frame,bounds));
  });
  const canvasItems=(state.canvasItems||[]).filter(item=>roots.some(frame=>contains(frame,canvasItemBounds(item))));
  const unique=rows=>[...new Map(rows.map(row=>[row.id,row])).values()].map(clone);
  return {frames:unique(frames),items:unique(items),canvasItems:unique(canvasItems)};
}
