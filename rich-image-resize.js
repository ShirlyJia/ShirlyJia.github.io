const MIN_WIDTH=24,MAX_WIDTH=4096;

/** Only a bounded integer width survives HTML cleanup; height remains proportional. */
export function safeImageWidth(value){
  const text=String(value??'').trim();if(!/^\d{1,4}$/.test(text))return null;
  const width=Number(text);return width>=1&&width<=MAX_WIDTH?width:null;
}
export function resizedImageWidth({width,height,dx,dy,corner='se',maxWidth=MAX_WIDTH}){
  if(![width,height,dx,dy,maxWidth].every(Number.isFinite)||width<=0||height<=0)throw Error('无效的图片尺寸');
  const horizontal=dx*(corner.includes('w')?-1:1),vertical=dy*(corner.includes('n')?-1:1)*width/height;
  const delta=Math.abs(horizontal)>=Math.abs(vertical)?horizontal:vertical;
  return Math.round(Math.max(Math.min(MIN_WIDTH,maxWidth),Math.min(MAX_WIDTH,maxWidth,width+delta)));
}

/** Handles live outside contenteditable, so only the image width enters saved HTML. */
export function mountImageResize(editor,{getImage,notify,message,signal}){
  const wrapper=editor.closest('.rich-editor'),input=wrapper.querySelector('[data-rich-image-width]');
  const overlay=document.createElement('div');overlay.className='rich-image-resize';overlay.hidden=true;
  overlay.innerHTML=['nw','ne','sw','se'].map(corner=>'<button type="button" class="rich-image-handle rich-image-handle-'+corner+'" data-rich-image-corner="'+corner+'" aria-label="'+({nw:'左上',ne:'右上',sw:'左下',se:'右下'}[corner])+'角缩放图片" title="拖动等比例缩放；方向键微调"></button>').join('');
  wrapper.append(overlay);let drag=null;
  const listen=(target,event,fn,options={})=>target.addEventListener(event,fn,{...options,signal});
  const image=()=>{const current=getImage();return current&&editor.contains(current)?current:null;};
  const scale=()=>{const rect=wrapper.getBoundingClientRect();return{x:rect.width/wrapper.offsetWidth||1,y:rect.height/wrapper.offsetHeight||1};};
  function maxWidth(img){
    let max=MAX_WIDTH;
    for(let node=img.parentElement;node&&wrapper.contains(node);node=node.parentElement){
      const style=getComputedStyle(node),width=node.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
      if(width>0)max=Math.min(max,width);if(node===editor)break;
    }
    return Math.max(1,Math.floor(max));
  }
  function sync(force=false){
    const img=image();if(!img){overlay.hidden=true;return;}
    const rect=img.getBoundingClientRect(),root=wrapper.getBoundingClientRect(),s=scale();
    overlay.hidden=!rect.width||!rect.height;if(overlay.hidden)return;
    Object.assign(overlay.style,{left:(rect.left-root.left)/s.x-wrapper.clientLeft+'px',top:(rect.top-root.top)/s.y-wrapper.clientTop+'px',width:rect.width/s.x+'px',height:rect.height/s.y+'px'});
    input.max=String(maxWidth(img));input.min=String(Math.min(MIN_WIDTH,maxWidth(img)));
    if(force||document.activeElement!==input)input.value=String(Math.round(rect.width/s.x));
  }
  function restore(img,width){if(width===null)img.removeAttribute('width');else img.setAttribute('width',width);}
  function finish(cancel=false){
    if(!drag)return;const current=drag;drag=null;
    if(current.handle.hasPointerCapture(current.id))current.handle.releasePointerCapture(current.id);
    wrapper.classList.remove('rich-image-resizing');
    const changed=current.moved&&current.image.getAttribute('width')!==current.original;
    if(cancel||!changed)restore(current.image,current.original);else notify();
    message('');sync(true);
  }
  function resizeTo(value){
    const img=image(),width=safeImageWidth(value);if(!img)return;
    if(width===null){message('请输入有效的图片宽度。',true);sync(true);return;}
    const next=Math.round(Math.max(Math.min(MIN_WIDTH,maxWidth(img)),Math.min(maxWidth(img),width)));
    if(img.getAttribute('width')!==String(next)){img.setAttribute('width',next);notify();}
    message('');sync(true);
  }
  function reset(){const img=image();if(!img)return;if(img.hasAttribute('width')){img.removeAttribute('width');notify();}message('');sync(true);}
  listen(overlay,'pointerdown',event=>{
    const handle=event.target.closest('[data-rich-image-corner]'),img=image();if(!handle||!img||event.button!==0||drag)return;
    event.preventDefault();event.stopPropagation();const rect=img.getBoundingClientRect(),s=scale();
    drag={id:event.pointerId,handle,image:img,original:img.getAttribute('width'),x:event.clientX,y:event.clientY,width:rect.width/s.x,height:rect.height/s.y,scale:s,corner:handle.dataset.richImageCorner,maxWidth:maxWidth(img),moved:false};
    handle.setPointerCapture(event.pointerId);wrapper.classList.add('rich-image-resizing');
  });
  listen(overlay,'pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;event.preventDefault();
    const dx=(event.clientX-drag.x)/drag.scale.x,dy=(event.clientY-drag.y)/drag.scale.y;
    if(Math.abs(dx)+Math.abs(dy)<2&&!drag.moved)return;drag.moved=true;
    drag.image.setAttribute('width',resizedImageWidth({...drag,dx,dy}));sync(true);
  });
  listen(overlay,'pointerup',event=>{if(drag?.id===event.pointerId){event.preventDefault();event.stopPropagation();finish();}});
  for(const type of ['pointercancel','lostpointercapture'])listen(overlay,type,event=>{if(drag?.id===event.pointerId)finish(true);});
  listen(window,'blur',()=>finish(true));
  listen(wrapper,'keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(true);}},{capture:true});
  listen(overlay,'keydown',event=>{
    event.stopPropagation();if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const img=image();if(img)resizeTo(Math.round(img.getBoundingClientRect().width/scale().x)+(event.shiftKey?50:10)*(['ArrowLeft','ArrowDown'].includes(event.key)?-1:1));
  });
  listen(overlay,'click',event=>event.stopPropagation());
  listen(input,'change',()=>resizeTo(input.value));
  listen(input,'keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();resizeTo(input.value);}if(event.key==='Escape'){event.preventDefault();sync(true);input.blur();}});
  listen(editor,'load',()=>sync(),{capture:true});
  listen(wrapper,'scroll',()=>sync(),{capture:true,passive:true});listen(window,'resize',()=>sync());
  const observer=new ResizeObserver(()=>sync());observer.observe(editor);observer.observe(wrapper);
  signal.addEventListener('abort',()=>{finish(true);observer.disconnect();overlay.remove();},{once:true});
  return {sync,reset,cancel:()=>finish(true),get active(){return !!drag;}};
}
