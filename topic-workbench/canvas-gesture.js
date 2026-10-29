import {canvasItemBounds} from './canvas-items.js';

const finite=value=>Number.isFinite(value)?value:0;
const clone=value=>structuredClone(value);
const validBox=box=>box&&[box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>=0&&box.h>=0;
const contains=(outer,inner)=>validBox(outer)&&validBox(inner)&&inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.w<=outer.x+outer.w&&inner.y+inner.h<=outer.y+outer.h;

/** Normalize wheel input to screen pixels before the view or world coordinates change. */
export function wheelDelta(event,{width=0,height=0,lineHeight=16}={}) {
  const mode=event?.deltaMode,dx=finite(event?.deltaX),dy=finite(event?.deltaY);
  if(mode===1){const unit=Math.max(0,finite(lineHeight));return{x:dx*unit,y:dy*unit};}
  if(mode===2)return{x:dx*Math.max(0,finite(width)),y:dy*Math.max(0,finite(height))};
  return{x:dx,y:dy};
}

/** Crossing a frame does not select the entire group; a marquee must enclose its body. */
export function enclosedFrameIds(frames,bounds) {
  if(!validBox(bounds))return[];
  return (frames||[]).filter(frame=>contains(bounds,frame)).map(frame=>frame.id);
}

/** Capture one immutable start state for every selected object, including overlapping groups. */
export function moveSelection(state,{instanceId,frameId}={}) {
  const frameIds=new Set(state.selectedFrames||[]),instanceIds=new Set(state.selected||[]);
  if(frameId)frameIds.add(frameId);if(instanceId)instanceIds.add(instanceId);
  const frames=(state.frames||[]).filter(frame=>frameIds.has(frame.id));
  for(const frame of frames)for(const id of frame.members||[])instanceIds.add(id);
  const unique=rows=>[...new Map(rows.map(row=>[row.id,row])).values()].map(clone);
  const items=(state.instances||[]).filter(instance=>instanceIds.has(instance.id));
  const canvasItems=(state.canvasItems||[]).filter(item=>frames.some(frame=>contains(frame,canvasItemBounds(item))));
  return{frames:unique(frames),items:unique(items),canvasItems:unique(canvasItems)};
}
