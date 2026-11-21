/** Per-field undo, including DOM operations such as tables, tasks and image resizing. */
export function textSelection(editor) {
  const range=window.getSelection()?.rangeCount?window.getSelection().getRangeAt(0):null;
  if(!range||!editor.contains(range.commonAncestorContainer))return null;
  const prefix=document.createRange();prefix.selectNodeContents(editor);prefix.setEnd(range.startContainer,range.startOffset);
  return {start:prefix.toString().length,end:prefix.toString().length+range.toString().length};
}
export function restoreTextSelection(editor,bookmark) {
  const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
  if(bookmark){
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let offset=0,start=null,end=null;
    while(walker.nextNode()){
      const node=walker.currentNode,length=node.nodeValue.length;
      if(!start&&bookmark.start<=offset+length)start=[node,Math.max(0,bookmark.start-offset)];
      if(bookmark.end<=offset+length){end=[node,Math.max(0,bookmark.end-offset)];break;}offset+=length;
    }
    if(start){range.setStart(...start);if(end)range.setEnd(...end);else range.collapse(true);}
  }
  editor.focus({preventScroll:true});const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
}
export function createRichHistory(editor,{read,restore,onState}) {
  let entries=[],index=0,depth=0,lastKind='',lastAt=0,restoring=false;
  const snapshot=()=>({html:read(),selection:textSelection(editor)});
  const update=()=>onState?.({undo:index>0,redo:index<entries.length-1});
  const boundary=()=>{lastKind='';lastAt=0;};
  const remember=()=>{if(!restoring&&entries[index]?.html===read()){const selection=textSelection(editor);if(selection)entries[index].selection=selection;}};
  function record(kind=''){
    if(depth||restoring)return;
    const next=snapshot();if(next.html===entries[index]?.html){remember();return;}
    const now=Date.now(),typing=['insertText','deleteContentBackward','deleteContentForward'].includes(kind);
    const merge=typing&&kind===lastKind&&now-lastAt<800&&index===entries.length-1&&index>0;
    entries.splice(index+1);if(merge)entries[index]=next;else{entries.push(next);index++;}
    // Bound image-heavy history without discarding the current value.
    let bytes=entries.reduce((sum,item)=>sum+item.html.length*2,0);
    while(entries.length>2&&(entries.length>80||bytes>16*1024*1024)){bytes-=entries.shift().html.length*2;index--;}
    lastKind=typing?kind:'';lastAt=now;update();
  }
  function move(delta){
    if(depth||restoring||index+delta<0||index+delta>=entries.length)return false;
    remember();index+=delta;restoring=true;
    try{restore(entries[index].html);restoreTextSelection(editor,entries[index].selection);}finally{restoring=false;boundary();update();}
    return true;
  }
  const reset=()=>{entries=[snapshot()];index=0;boundary();update();};reset();
  return {record,remember,boundary,reset,undo:()=>move(-1),redo:()=>move(1),begin(){if(!depth)remember();depth++;boundary();},end(){depth=Math.max(0,depth-1);if(!depth)record();}};
}
