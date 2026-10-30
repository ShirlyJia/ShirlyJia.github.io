/** Keep legacy newest-first display, with a separate, manually ordered pinned area. */
export function orderedComments(comments = []) {
  const rows = [...comments].reverse();
  return [...rows.filter(row => row.pinned), ...rows.filter(row => !row.pinned)];
}

export function moveComment(comments, id, targetId, side = 'before') {
  const rows = orderedComments(comments), moving = rows.find(row => row.id === id);
  const target = rows.find(row => row.id === targetId);
  if (!moving || !target || id === targetId || Boolean(moving.pinned) !== Boolean(target.pinned)) return comments;
  const next = rows.filter(row => row.id !== id);
  next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, moving);
  return next.every((row, index) => row === rows[index]) ? comments : next.reverse();
}

export function setCommentPinned(comments, id, pinned) {
  const current = comments.find(row => row.id === id);
  if (!current || Boolean(current.pinned) === pinned) return comments;
  const rows = orderedComments(comments).filter(row => row.id !== id);
  const index = pinned ? 0 : rows.filter(row => row.pinned).length;
  rows.splice(index, 0, {...current, pinned});
  return rows.reverse();
}

/** A handle keeps text selection/editing separate from pointer and touch sorting. */
export function mountCommentSorting(root, {getComments, beforeMove, onMove}) {
  const controller = new AbortController(), signal = controller.signal;
  let drag = null, frame = 0;
  const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, {...options, signal});
  const cards = () => [...root.querySelectorAll('[data-comment-card]')];
  const handleFor = id => [...root.querySelectorAll('[data-comment-drag]')].find(node => node.dataset.commentDrag === id);
  const clearMarker = () => root.querySelectorAll('.comment-drop-before,.comment-drop-after').forEach(node => node.classList.remove('comment-drop-before', 'comment-drop-after'));
  const cleanup = () => {
    const current = drag; drag = null; cancelAnimationFrame(frame); frame = 0;
    clearMarker(); current?.card.classList.remove('is-comment-dragging'); current?.ghost?.remove();
    document.body.classList.remove('comment-sorting');
    if (current && root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
  };
  const locate = () => {
    if (!drag?.active) return;
    clearMarker();
    const bounds = root.getBoundingClientRect();
    drag.ghost.style.left = Math.max(bounds.left + 12, Math.min(drag.x + 14, bounds.right - drag.ghost.offsetWidth - 12)) + 'px';
    drag.ghost.style.top = Math.max(8, Math.min(drag.y + 12, innerHeight - drag.ghost.offsetHeight - 8)) + 'px';
    const comments = getComments(), moving = comments.find(row => row.id === drag.id);
    const eligible = cards().filter(card => {
      const row = comments.find(item => item.id === card.dataset.commentCard);
      return row && row.id !== drag.id && Boolean(row.pinned) === Boolean(moving?.pinned);
    });
    drag.target = null;
    if (!eligible.length || drag.x < bounds.left || drag.x > bounds.right) return;
    const target = eligible.find(card => drag.y < card.getBoundingClientRect().top + card.offsetHeight / 2) || eligible.at(-1);
    const side = drag.y < target.getBoundingClientRect().top + target.offsetHeight / 2 ? 'before' : 'after';
    target.classList.add('comment-drop-' + side); drag.target = {id:target.dataset.commentCard, side};
  };
  const autoscroll = () => {
    if (!drag?.active) return;
    const bounds = root.getBoundingClientRect(), edge = 64;
    const speed = drag.y < bounds.top + edge ? -Math.min(14, (bounds.top + edge - drag.y) / 4) : drag.y > bounds.bottom - edge ? Math.min(14, (drag.y - bounds.bottom + edge) / 4) : 0;
    if (speed && drag.x >= bounds.left && drag.x <= bounds.right) { root.scrollTop += speed; locate(); }
    frame = requestAnimationFrame(autoscroll);
  };
  listen(root, 'pointerdown', event => {
    const handle = event.target.closest('[data-comment-drag]');
    if (!handle || event.button !== 0 || drag || beforeMove?.() === false) return;
    event.preventDefault(); event.stopPropagation(); handle.focus({preventScroll:true});
    drag = {id:handle.dataset.commentDrag, card:handle.closest('[data-comment-card]'), pointerId:event.pointerId, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY};
    root.setPointerCapture?.(event.pointerId);
  });
  listen(document, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true; drag.card.classList.add('is-comment-dragging'); document.body.classList.add('comment-sorting');
      drag.ghost = document.createElement('div'); drag.ghost.className = 'comment-drag-preview';
      drag.ghost.textContent = getComments().find(row => row.id === drag.id)?.author || '随手记录';
      drag.ghost.setAttribute('aria-hidden', 'true'); document.body.append(drag.ghost); frame = requestAnimationFrame(autoscroll);
    }
    locate();
  }, {passive:false});
  listen(document, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const {id, target, active} = drag; cleanup();
    if (active && target) onMove(id, target.id, target.side);
    handleFor(id)?.focus({preventScroll:true});
  });
  listen(document, 'pointercancel', cleanup);
  listen(root, 'lostpointercapture', () => { if (drag) cleanup(); });
  listen(window, 'blur', cleanup);
  listen(document, 'keydown', event => {
    if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cleanup(); }
  }, {capture:true});
  listen(root, 'click', event => { if (event.target.closest('[data-comment-drag]')) { event.preventDefault(); event.stopPropagation(); } });
  listen(root, 'keydown', event => {
    const handle = event.target.closest('[data-comment-drag]');
    if (!handle || !event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (beforeMove?.() === false) return;
    const id = handle.dataset.commentDrag, rows = orderedComments(getComments()), current = rows.find(row => row.id === id);
    const group = rows.filter(row => Boolean(row.pinned) === Boolean(current?.pinned));
    const target = group[group.indexOf(current) + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target) onMove(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after');
    handleFor(id)?.focus({preventScroll:true});
  });
  return () => { cleanup(); controller.abort(); };
}
