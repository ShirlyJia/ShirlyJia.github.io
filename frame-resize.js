/** Resize the requested edges; opposite edges stay anchored and contents stay put. */
export const frameResizeEdges = ['n','ne','e','se','s','sw','w','nw'];
export const frameEdgeNames = {n:'上边框',ne:'右上角',e:'右边框',se:'右下角',s:'下边框',sw:'左下角',w:'左边框',nw:'左上角'};
export function resizeFrameBounds(frame,edge,dx,dy,{minWidth=120,minHeight=100}={}) {
  if(!frameResizeEdges.includes(edge))throw Error('无效的分组边框');
  if(![frame.x,frame.y,frame.w,frame.h,dx,dy,minWidth,minHeight].every(Number.isFinite)||frame.w<=0||frame.h<=0||minWidth<=0||minHeight<=0)throw Error('无效的分组尺寸');
  let {x,y,w,h}=frame;
  if(edge.includes('e'))w=Math.max(minWidth,w+dx);
  if(edge.includes('s'))h=Math.max(minHeight,h+dy);
  if(edge.includes('w')){const right=x+w;x=Math.min(x+dx,right-minWidth);w=right-x;}
  if(edge.includes('n')){const bottom=y+h;y=Math.min(y+dy,bottom-minHeight);h=bottom-y;}
  return {x,y,w,h};
}
