export function detailWidth(value, available) {
  const max = Math.max(0, available - 80), min = Math.min(360, max);
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 560));
}

export function mountDetailResize({panel, handle, container, key, onResize = () => {}}) {
  let preferred = 560, drag = null, frame;
  try { const saved = Number(localStorage.getItem(key)); if (saved > 0) preferred = saved; } catch {}
  const mobile = () => matchMedia('(max-width:760px)').matches;
  function apply(value = preferred) {
    const width = detailWidth(value, container.clientWidth);
    panel.style.setProperty('--detail-width', width + 'px');
    container.style.setProperty('--detail-width', width + 'px');
    handle.setAttribute('aria-valuemin', String(Math.min(360, Math.max(0, container.clientWidth - 80))));
    handle.setAttribute('aria-valuemax', String(Math.max(0, container.clientWidth - 80)));
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
    cancelAnimationFrame(frame);frame=requestAnimationFrame(onResize);
    return width;
  }
  function persist() { try { localStorage.setItem(key, String(preferred)); } catch {} }
  function finish(cancel = false) {
    if (!drag) return;
    const current = drag;drag = null;
    preferred = cancel ? current.preferred : detailWidth(preferred, container.clientWidth);
    document.body.classList.remove('detail-resizing');
    if (handle.hasPointerCapture(current.id)) handle.releasePointerCapture(current.id);
    apply();if (!cancel) persist();
  }
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || mobile() || drag) return;
    e.preventDefault();e.stopPropagation();handle.focus({preventScroll:true});
    drag = {id:e.pointerId,x:e.clientX,width:panel.getBoundingClientRect().width,preferred};
    handle.setPointerCapture(e.pointerId);document.body.classList.add('detail-resizing');
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    preferred = apply(drag.width + drag.x - e.clientX);
  });
  handle.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) finish(); });
  handle.addEventListener('pointercancel', e => { if (drag?.id === e.pointerId) finish(true); });
  handle.addEventListener('lostpointercapture', e => { if (drag?.id === e.pointerId) finish(true); });
  handle.addEventListener('dblclick', () => { preferred=560;apply();persist(); });
  handle.addEventListener('keydown', e => {
    if (e.key==='Escape' && drag) { e.preventDefault();e.stopPropagation();finish(true);return; }
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key) || mobile()) return;
    e.preventDefault();e.stopPropagation();
    preferred=apply(e.key==='Home'?360:e.key==='End'?container.clientWidth-80:panel.getBoundingClientRect().width+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?80:24));persist();
  });
  window.addEventListener('blur', () => finish(true));
  const observer = new ResizeObserver(() => {if(!drag)apply();});observer.observe(container);
  apply();
}
