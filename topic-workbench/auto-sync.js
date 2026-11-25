export const SYNC_ORIGIN = 'http://127.0.0.1:8768';
const REF_URL = 'https://api.github.com/repos/ShirlyJia/ShirlyJia.github.io/git/ref/heads/topic-board-data';
const RAW_REPO = 'https://raw.githubusercontent.com/ShirlyJia/ShirlyJia.github.io/';
const BOARD_PATH = '/topic-workbench/live-board.json';
let pinned, nextRefCheck=0;
const isRevision = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const nextWriteId = () => crypto.randomUUID().replaceAll('-','');

export function boardFingerprint(board) {
  const {view, ...content} = board;
  return JSON.stringify(content,(_,value)=>value && typeof value==='object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value);
}

async function jsonRequest(url, {timeout=15000, ...options} = {}) {
  const response = await fetch(url, {cache:'no-store', ...options, signal:AbortSignal.timeout(timeout)});
  if (!response.ok) {
    const data = await response.json().catch(()=>null);
    const error = new Error(data?.error || '无法读取线上画板');
    error.status = response.status;
    if ([403,429].includes(error.status)) {
      const retry=(Number(response.headers.get('Retry-After'))||0)*1000;
      const reset=(Number(response.headers.get('X-RateLimit-Reset'))||0)*1000-Date.now();
      error.backoff=Math.max(retry,reset,60000);
    }
    throw error;
  }
  return response.json();
}

export function validateRelease(release) {
  if (!release || !isRevision(release.revision) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(release.updatedAt) || !Number.isFinite(Date.parse(release.updatedAt)) ||
      release.board?.schemaVersion !== 2 || !Array.isArray(release.board.projects)) {
    throw Error('线上画板格式不完整');
  }
  return release;
}

async function loadBridgeBoard(connection, request = jsonRequest) {
  return validateRelease(await request(SYNC_ORIGIN + '/state', {
    headers:{Authorization:'Bearer ' + connection}
  }));
}

export async function loadSharedBoard({connection = '', publicSite = false, checkApi = true, request = jsonRequest} = {}) {
  if (connection) {
    try { return await loadBridgeBoard(connection, request); } catch {}
  }
  if (!publicSite) return null;
  // Discover the current commit separately from the cacheable board document.
  if (checkApi && Date.now()>=nextRefCheck) {
    try {
      const ref=await request(REF_URL,{cache:'no-cache',timeout:6500});
      const commit=ref?.object?.sha;
      if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('线上版本标识无效');
      if (pinned?.commit===commit) return pinned.release;
      const release=validateRelease(await request(RAW_REPO+commit+BOARD_PATH,{cache:'force-cache',timeout:7000}));
      pinned={commit,release};
      return release;
    } catch (error) {
      if (error.backoff) nextRefCheck=Date.now()+error.backoff;
    }
  }
  try {
    return validateRelease(await request(RAW_REPO+'topic-board-data'+BOARD_PATH, {cache:'no-cache', timeout:7000}));
  } catch { return null; }
}

export function newerSharedBoard(previous, incoming) {
  return !!incoming && (!previous || (incoming.revision !== previous.revision &&
    Date.parse(incoming.updatedAt) > Date.parse(previous.updatedAt)));
}

export function watchSharedBoard({release, apply, load = loadSharedBoard, interval = 15000}) {
  let current=release, checking=false, lastApiCheck=Date.now();
  async function refresh() {
    if (checking || document.hidden) return;
    checking=true;
    try {
      const checkApi = Date.now() - lastApiCheck >= 90000;
      if (checkApi) lastApiCheck=Date.now();
      const next=await load({publicSite:true,checkApi});
      if (newerSharedBoard(current,next)) {
        apply(next);
        current=next;
      }
    } catch { /* Keep the last visible release and retry. */ }
    finally { checking=false; }
  }
  const timer=setInterval(refresh,interval);
  window.addEventListener('focus',refresh);
  window.addEventListener('online',refresh);
  document.addEventListener('visibilitychange',refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus',refresh);
    window.removeEventListener('online',refresh);
    document.removeEventListener('visibilitychange',refresh);
  };
}

const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest(
  'SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');

export function readLiveBaseline(storage, key) {
  try { return JSON.parse(storage.getItem(key+':baseline') || 'null'); } catch { return null; }
}

export function cachedBoardRevision(storage, key) {
  const revision=readLiveBaseline(storage,key)?.revision;
  return isRevision(revision) ? revision : null;
}

export function isOlderThanLiveBaseline(storage, key, release) {
  const previous=readLiveBaseline(storage,key);
  return !!release && Date.parse(release.updatedAt)<Date.parse(previous?.updatedAt);
}

export async function rememberLiveBaseline(storage, key, release) {
  const fingerprint=await digest(boardFingerprint(release.board));
  const previous=readLiveBaseline(storage,key);
  if (previous?.updatedAt && Date.parse(previous.updatedAt)>Date.parse(release.updatedAt)) return;
  storage.setItem(key+':baseline',JSON.stringify({revision:release.revision, updatedAt:release.updatedAt,
    edition:release.updatedAt.slice(0,10)+'-'+release.revision.slice(0,16),fingerprint,ordered:true}));
}

// Reuse one current copy. Preserve only unsubmitted edits when a newer release
// arrives, rather than filling browser storage with every published revision.
export async function prepareLiveStorage({storage, key, archivePrefix, release}) {
  const raw=storage.getItem(key),meta=readLiveBaseline(storage,key);
  if (raw && meta?.revision !== release.revision) {
    // Parsing failures surface through normal persistence recovery; never erase.
    let previous;
    try { previous=JSON.parse(raw); } catch { return; }
    const previousContent=boardFingerprint(previous);
    let unchanged=await digest(previousContent)===meta?.fingerprint;
    if (meta?.fingerprint && !meta.ordered && !unchanged) {
      const {view,...legacyContent}=previous;
      unchanged=await digest(JSON.stringify(legacyContent))===meta.fingerprint;
    }
    if (!unchanged && previousContent!==boardFingerprint(release.board)) {
      const oldEdition=meta?.edition || release.updatedAt.slice(0,10)+'-'+crypto.randomUUID().replaceAll('-','').slice(0,16);
      storage.setItem(archivePrefix+':'+oldEdition,raw);
    }
    storage.setItem(key,JSON.stringify(release.board));
  }
  await rememberLiveBaseline(storage,key,release);
}

export function createAutoSync({key, release, baseline = null, getData, status, storage = localStorage,
                               onBaseline = ()=>{}, onPublished = ()=>{}, request = jsonRequest, delay = 1500}) {
  const tokenKey=key+':connection',draftKey=key+':pending';
  let token=storage.getItem(tokenKey)||'', revision=release?.revision??baseline;
  let acknowledged=release?boardFingerprint(release.board):null;
  let pending=null, stagedId=null, sending=false, needsPairing=false, conflictRevision=null, timer=null;
  let retryDelay=delay;
  try {
    const saved=JSON.parse(storage.getItem(draftKey)||'null');
    if (token && saved?.board?.schemaVersion===2) pending=saved;
  } catch { status('待同步备份读取失败，请先导出画板'); }

  const paused=()=>needsPairing || conflictRevision!==null;
  const canProgress=()=>!paused() || (conflictRevision!==null && stagedId===pending?.writeId);
  const report=text=>status(text,Boolean(conflictRevision));
  function persist() {
    if (pending) storage.setItem(draftKey,JSON.stringify(pending));
  }
  function clearDraft(submitted) {
    const raw=storage.getItem(draftKey);
    if (raw) {
      try {
        const saved=JSON.parse(raw);
        if ((submitted.writeId && saved.writeId===submitted.writeId) ||
            (!submitted.writeId && boardFingerprint(saved.board)===boardFingerprint(submitted.board))) {
          storage.removeItem(draftKey);
        }
      } catch {}
    }
    pending=null;
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (token && pending && canProgress()) timer=setTimeout(sync,ms);
  }
  function nextDraft(board,baseRevision) {
    const earlierWrites=[...(pending?.earlierWrites||[])];
    if (pending?.writeId) earlierWrites.push(pending.writeId);
    pending={board:structuredClone(board),baseRevision,earlierWrites};
    try { persist(); } catch { /* The saved board can still be sent to the Mac. */ }
  }
  function changed(board) {
    if (!token) return;
    const fingerprint=boardFingerprint(board);
    if (!pending && fingerprint===acknowledged) return;
    if (pending && fingerprint===boardFingerprint(pending.board)) return;
    nextDraft(board,pending?.baseRevision??revision);
    if (!paused()) sync();
  }
  function useOnlineBaseline(saved) {
    revision=saved.revision;
    acknowledged=boardFingerprint(saved.board);
    conflictRevision=null;
    onBaseline(saved);
  }
  function accept(saved,submitted) {
    useOnlineBaseline(saved);
    clearDraft(submitted);
    report('已同步到线上');
    onPublished(saved);
  }
  async function sync() {
    if (sending || !pending || !token || !canProgress()) return;
    clearTimeout(timer);
    sending=true;
    const submitted=pending;
    const activeToken=token;
    try {
      if (!submitted.writeId) {
        submitted.writeId=nextWriteId();
        try { persist(); } catch { /* The background copy is independent of browser quota. */ }
      }
      const checking=stagedId===submitted.writeId;
      const headers={Authorization:'Bearer '+activeToken};
      if (!checking) report('正在交给 Mac 后台…');
      const ticket=checking
        ? await request(SYNC_ORIGIN+'/outbox?writeId='+submitted.writeId,{headers,timeout:5000})
        : await request(SYNC_ORIGIN+'/outbox',{
            method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(submitted),timeout:6000
          });
      if (pending!==submitted || activeToken!==token) return;
      retryDelay=delay;
      switch (ticket.status) {
        case 'published':
          accept(validateRelease({...ticket.release,board:submitted.board}),submitted);
          break;
        case 'queued':
        case 'retry':
          stagedId=submitted.writeId;
          report(ticket.status==='retry'?'已交给后台 · 等待自动重试':'已交给后台 · 发布中');
          break;
        case 'conflict':
          if (!isRevision(ticket.conflictRevision)) throw Error('发布状态缺少线上版本');
          stagedId=submitted.writeId;
          conflictRevision=ticket.conflictRevision;
          retryDelay=15000;
          report('线上有更新，自动同步已暂停');
          break;
        case 'busy':
          report('另一个画板正在发布，本机修改已保留');
          retryDelay=5000;
          break;
        case 'missing':
          stagedId=null; retryDelay=0;
          break;
        case 'superseded': {
          const latest=await loadBridgeBoard(activeToken,request);
          if (pending!==submitted || activeToken!==token) return;
          stagedId=null;
          if (boardFingerprint(latest.board)===boardFingerprint(submitted.board)) accept(latest,submitted);
          else {
            conflictRevision=latest.revision;
            report('线上有更新，自动同步已暂停');
          }
          break;
        }
        default: throw Error('无法确认后台状态');
      }
    } catch(error) {
      if (pending!==submitted || activeToken!==token) return;
      if ([401,403].includes(error.status)) {
        needsPairing=true; report('请检查这台 Mac 的同步连接');
      } else {
        retryDelay=Math.min(Math.max(retryDelay*2,3000),30000);
        report(stagedId===submitted.writeId?'已交给后台 · 等待状态确认':'修改已保留，等待连接后台');
      }
    } finally {
      sending=false;
      schedule(pending===submitted?retryDelay:0);
    }
  }
  return {
    connection:()=>token,
    pendingBoard:()=>pending?.board,
    awaitingHandoff:()=>!!token && !!pending && !paused() && (!pending.writeId || stagedId!==pending.writeId),
    changed,
    async connect(value) {
      const current=await loadBridgeBoard(value,request);
      storage.setItem(tokenKey,value);token=value;needsPairing=false;
      useOnlineBaseline(current);
      report('自动同步已开启');changed(getData());schedule(0);
    },
    disconnect() {
      clearTimeout(timer);token='';storage.removeItem(tokenKey);conflictRevision=null;
      report('已停止提交新修改');
    },
    start() {
      if (!token) return;
      if (pending && !pending.writeId && acknowledged===boardFingerprint(pending.board)) clearDraft(pending);
      report(pending?'等待同步':release?'已同步到线上':'自动同步已开启');
      schedule(0);
    },
    retry() { if (!sending) schedule(0); },
    async publishLocalVersion() {
      if (sending || !conflictRevision || !pending || !token) return;
      const reviewed=conflictRevision;
      sending=true;
      try {
        const latest=await loadBridgeBoard(token,request);
        if (latest.revision===reviewed || boardFingerprint(latest.board)===boardFingerprint(pending.board)) {
          useOnlineBaseline(latest);
          nextDraft(pending.board,latest.revision);
        } else {
          conflictRevision=latest.revision;
          report('线上再次更新，本机修改已保留');
        }
      } catch { report('暂时无法核对线上版本，本机修改已保留'); }
      finally { sending=false; schedule(0); }
    },
    dispose() { clearTimeout(timer); }
  };
}

export function mountAutoSync({key, release, dataKey, getData, notify, onPublished}) {
  const container=document.querySelector('#settingsDialog .settings-links');
  const button=document.createElement('button');
  const detail=document.createElement('p');
  const resolve=document.createElement('button');
  resolve.textContent='发布本机版本';resolve.hidden=true;
  const badge=document.createElement('button');
  badge.className='save-status';badge.id='syncStatus';
  badge.onclick=()=>document.getElementById('settingsDialog').showModal();
  document.getElementById('saveStatus').after(badge);
  const sync=createAutoSync({key,release,getData,onPublished,baseline:cachedBoardRevision(localStorage,dataKey),
    onBaseline:saved=>{rememberLiveBaseline(localStorage,dataKey,saved).catch(()=>{});},
    status:(text,conflict)=>{
      badge.textContent=text;badge.hidden=false;resolve.hidden=!conflict;
      detail.textContent=conflict?text+'。发布本机版本后，先前的线上版本仍可从发布历史恢复。':text;
    }});
  resolve.onclick=async()=>{
    resolve.disabled=true;
    try { await sync.publishLocalVersion(); } finally { resolve.disabled=false; }
  };
  button.textContent=sync.connection()?'关闭自动同步':'连接这台 Mac 自动同步';
  badge.hidden=!sync.connection();
  detail.textContent=sync.connection()?'Mac 后台接收后，关闭页面也会继续发布。':'连接后，项目内容、分组与布局会自动发布到原网址。';
  container.prepend(button,detail,resolve);
  let pairing=null, pairingNonce='';
  button.onclick=()=>{
    if(sync.connection()){
      sync.disconnect();button.textContent='连接这台 Mac 自动同步';return;
    }
    pairingNonce=crypto.randomUUID().replaceAll('-','');
    detail.textContent='正在连接这台 Mac…';
    pairing=window.open(SYNC_ORIGIN+'/pair?origin='+encodeURIComponent(location.origin)+'&nonce='+pairingNonce,
                        'topic-canvas-pair','width=520,height=420');
    if(!pairing)notify('请允许打开连接窗口');
  };
  window.addEventListener('message',async event=>{
    if(event.origin!==SYNC_ORIGIN||!pairingNonce||event.data?.nonce!==pairingNonce||event.data?.type!=='topic-canvas-paired'||
       !/^[a-f0-9]{64}$/.test(event.data.token||''))return;
    detail.textContent='正在验证连接…';
    try{await sync.connect(event.data.token);button.textContent='关闭自动同步';notify('自动同步已开启');
      event.source?.postMessage({type:'topic-canvas-connected',nonce:pairingNonce},SYNC_ORIGIN);pairingNonce='';}
    catch{detail.textContent='连接未完成，请重试';notify('连接未完成，请重试');}
  });
  window.addEventListener('online',()=>sync.retry());
  document.addEventListener('visibilitychange',()=>sync.retry());
  return sync;
}
