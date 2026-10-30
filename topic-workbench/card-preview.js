/** Reserve space for existing card metadata without moving any placements. */
export function previewLines({height,noteHeight,lineHeight,space=Infinity,maxLines=4}){
  if(!Number.isFinite(lineHeight)||lineHeight<=0)return maxLines;
  return Math.max(1,Math.min(maxLines,Math.floor((space-height+noteHeight)/lineHeight)));
}

export function fitCardPreviews(world,frames=[]){
  const cards=[...world.querySelectorAll('.project-card[data-instance]')].map(card=>({
    card,id:card.dataset.instance,x:card.offsetLeft,y:card.offsetTop,w:card.offsetWidth
  })).filter(item=>item.w>0);
  for(const current of cards){
    const note=current.card.querySelector('.card-note');if(!note)continue;
    let space=Infinity;
    for(const next of cards){
      if(next.y>current.y&&next.x<current.x+current.w&&next.x+next.w>current.x)
        space=Math.min(space,next.y-current.y-10);
    }
    for(const frame of frames){
      if(frame.members?.includes(current.id)&&frame.y<=current.y)
        space=Math.min(space,frame.y+frame.h-current.y-10);
    }
    const lines=previewLines({height:current.card.offsetHeight,noteHeight:note.offsetHeight,lineHeight:parseFloat(getComputedStyle(note).lineHeight),space});
    note.style.setProperty('--card-preview-lines',lines);
  }
}
