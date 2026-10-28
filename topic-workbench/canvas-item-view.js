/** Rendering only. Canvas objects remain independent of project facts. */
const NS='http://www.w3.org/2000/svg';
const labels={text:'文字',note:'便签',line:'线条',arrow:'箭头'};
const safeColor=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function svgElement(name,attributes){
  const element=document.createElementNS(NS,name);
  for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
  return element;
}
function contrastText(color){
  const channels=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]>.36?'#403b32':'#ffffff';
}
function handle(kind,id,label){
  const button=document.createElement('button');button.type='button';button.className='canvas-handle';button.tabIndex=-1;
  button.setAttribute('aria-label',label);button.title=label;
  if(kind==='resize')button.dataset.canvasResize=id;
  else button.dataset.canvasEndpoint=kind;
  return button;
}

export function renderCanvasItem(item,{selected=false}={}){
  const type=Object.hasOwn(labels,item.type)?item.type:'text',linear=type==='line'||type==='arrow';
  const element=document.createElement('div');element.className=`canvas-item canvas-${type}${selected?' selected':''}`;
  element.dataset.canvasItem=item.id;element.tabIndex=0;element.setAttribute('role','group');
  element.setAttribute('aria-label',labels[type]+(linear?'，拖动移动，选中后可调整端点':'：'+(item.text?.trim().slice(0,70)||'未填写')+'，双击编辑'));
  if(linear){
    const padding=14,x=finite(item.x),y=finite(item.y),x2=finite(item.x2),y2=finite(item.y2);
    const left=Math.min(x,x2)-padding,top=Math.min(y,y2)-padding,width=Math.max(Math.abs(x2-x),1)+padding*2,height=Math.max(Math.abs(y2-y),1)+padding*2;
    Object.assign(element.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
    const ax=x-left,ay=y-top,bx=x2-left,by=y2-top,stroke=clamp(finite(item.strokeWidth,2),1,12),color=safeColor(item.color,'#73726e');
    const svg=svgElement('svg',{width,height,viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true',focusable:'false'});
    const hit=svgElement('line',{x1:ax,y1:ay,x2:bx,y2:by,stroke:'transparent','stroke-width':Math.max(16,stroke+10),'stroke-linecap':'round',class:'canvas-line-hit','data-canvas-hit':item.id});
    svg.append(hit,svgElement('line',{x1:ax,y1:ay,x2:bx,y2:by,stroke:color,'stroke-width':stroke,'stroke-linecap':'round',class:'canvas-line-stroke'}));
    const length=Math.hypot(bx-ax,by-ay);
    if(type==='arrow'&&length>.1){
      const ux=(bx-ax)/length,uy=(by-ay)/length,head=Math.min(length*.65,Math.max(12,stroke*3)),spread=head*.48;
      const baseX=bx-ux*head,baseY=by-uy*head;
      svg.append(svgElement('path',{d:`M ${baseX-uy*spread} ${baseY+ux*spread} L ${bx} ${by} L ${baseX+uy*spread} ${baseY-ux*spread}`,fill:'none',stroke:color,'stroke-width':stroke,'stroke-linecap':'round','stroke-linejoin':'round',class:'canvas-line-stroke'}));
    }
    element.append(svg);
    for(const [endpoint,hx,hy] of [['start',ax,ay],['end',bx,by]]){
      const button=handle(endpoint,item.id,endpoint==='start'?'调整起点':'调整终点');
      Object.assign(button.style,{left:hx+'px',top:hy+'px'});element.append(button);
    }
  }else{
    const note=type==='note',color=safeColor(item.color,note?'#fff3bf':'#37352f');
    Object.assign(element.style,{left:finite(item.x)+'px',top:finite(item.y)+'px',width:Math.max(1,finite(item.w,240))+'px',height:Math.max(1,finite(item.h,160))+'px',fontSize:clamp(finite(item.fontSize,note?18:24),10,64)+'px',color:note?contrastText(color):color});
    if(note)element.style.backgroundColor=color;
    element.title='双击编辑内容，拖动移动';
    const content=document.createElement('div');content.className='canvas-item-text';content.textContent=typeof item.text==='string'?item.text:'';
    content.dataset.placeholder=note?'双击写便签…':'双击输入文字…';element.append(content);
    const resize=handle('resize',item.id,'调整大小');resize.classList.add('canvas-resize-handle');element.append(resize);
  }
  return element;
}
