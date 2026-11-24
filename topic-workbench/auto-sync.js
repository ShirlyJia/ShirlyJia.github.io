export const SYNC_ORIGIN = 'http://127.0.0.1:8768';
export const LIVE_BOARD_URL = 'https://api.github.com/repos/ShirlyJia/ShirlyJia.github.io/contents/topic-workbench/live-board.json?ref=topic-board-data';
const RAW_BOARD_URL = 'https://raw.githubusercontent.com/ShirlyJia/ShirlyJia.github.io/topic-board-data/topic-workbench/live-board.json';
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
  // The branch URL can still be cached after a GitHub write is acknowledged.
  if (checkApi) {
    try {
      return validateRelease(await request(LIVE_BOARD_URL + '&t=' + Date.now(), {
        headers:{Accept:'application/vnd.github.raw+json'}, timeout:7000
      }));
    } catch {}
  }
  try {
    return validateRelease(await request(RAW_BOARD_URL, {cache:'no-cache', timeout:7000}));
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

function readBaseline(storage, key) {
  try { return JSON.parse(storage.getItem(key+':baseline') || 'null'); } catch { return null; }
}

export function cachedBoardRevision(storage, key) {
  const revision=readBaseline(storage,key)?.revision;
  return isRevision(revision) ? revision : null;
}

export function isOlderThanLiveBaseline(storage, key, release) {
  const previous=readBaseline(storage,key);
  return !!release && Date.parse(release.updatedAt)<Date.parse(previous?.updatedAt);
}

export async function rememberLiveBaseline(storage, key, release) {
  const fingerprint=await digest(boardFingerprint(release.board));
  const previous=readBaseline(storage,key);
  if (previous?.updatedAt && Date.parse(previous.updatedAt)>Date.parse(release.updatedAt)) return;
  storage.setItem(key+':baseline',JSON.stringify({revision:release.revision, updatedAt:release.updatedAt,
    edition:release.updatedAt.slice(0,10)+'-'+release.revision.slice(0,16),fingerprint,ordered:true}));
}

// Reuse one current copy. Preserve only unsubmitted edits when a newer release
// arrives, rather than filling browser storage with every published revision.
export async function prepareLiveStorage({storage, key, archivePrefix, release}) {
  const raw=storage.getItem(key),meta=readBaseline(storage,key);
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
                               onBaseline = ()=>{}, request = jsonRequest, delay = 2000}) {
  const tokenKey = key + ':connection', draftKey = key + ':pending';
  let token = storage.getItem(tokenKey) || '';
  let revision = release?.revision ?? baseline;
  let acknowledged = release ? boardFingerprint(release.board) : null;
  let pending = null, timer = null, uploading = false, needsPairing = false, conflictRevision = null, retryDelay = delay;
  try {
    const saved = JSON.parse(storage.getItem(draftKey) || 'null');
    if (token && saved?.board?.schemaVersion === 2) pending = saved;
  } catch { status('待同步备份读取失败，请先导出画板'); }
  const report = text => status(text,Boolean(conflictRevision));
  const paused = () => needsPairing || conflictRevision !== null;
  function persist() {
    if (pending) storage.setItem(draftKey,JSON.stringify(pending));
    else storage.removeItem(draftKey);
  }
  function schedule(ms = delay) {
    clearTimeout(timer);
    if (token && pending && !paused()) timer = setTimeout(publish,ms);
  }
  function changed(board) {
    if (!token) return;
    const fingerprint = boardFingerprint(board);
    if (!pending && fingerprint === acknowledged) return;
    if (pending && fingerprint === boardFingerprint(pending.board)) return;
    const earlierWrites = [...(pending?.earlierWrites || [])];
    if (pending?.writeId) earlierWrites.push(pending.writeId);
    pending = {board:structuredClone(board), baseRevision:pending?.baseRevision ?? revision, earlierWrites};
    try { persist(); } catch { report('待同步内容保存失败，请导出备份'); return; }
    if (!paused()) { report('等待同步'); schedule(); }
  }
  function useOnlineBaseline(saved) {
    revision=saved.revision;
    acknowledged=boardFingerprint(saved.board);
    conflictRevision=null;
    onBaseline(saved);
  }
  function rebaseDraft(saved) {
    useOnlineBaseline(saved);
    pending.baseRevision=revision;
    pending.earlierWrites=[];
    delete pending.writeId;
    persist();
  }
  function accept(saved,submitted) {
    if (pending===submitted || boardFingerprint(pending.board)===boardFingerprint(saved.board)) {
      useOnlineBaseline(saved);
      pending=null;
      persist();
    } else rebaseDraft(saved);
    retryDelay=delay;
    report(pending?'等待同步':'已同步到线上');
  }
  function inspectConflict(latest) {
    if (boardFingerprint(latest.board)===boardFingerprint(pending.board)) {
      accept(latest,pending);
    } else if (latest.writeId && pending.earlierWrites?.includes(latest.writeId)) {
      // Only a confirmed earlier payload from this draft may advance its base.
      rebaseDraft(latest);
      retryDelay=0;
      report('等待同步');
    } else {
      conflictRevision=latest.revision;
      report('线上有更新，自动同步已暂停');
    }
  }
  async function publish() {
    if (uploading || !pending || !token || paused()) return;
    uploading = true;
    const submitted = pending;
    report('正在同步…');
    try {
      if (!submitted.writeId) { submitted.writeId=nextWriteId(); persist(); }
      const saved = validateRelease(await request(SYNC_ORIGIN + '/publish', {
        method:'POST',headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json'},
        body:JSON.stringify({board:submitted.board,baseRevision:submitted.baseRevision,writeId:submitted.writeId}),
        timeout:45000
      }));
      accept(saved,submitted);
    } catch (error) {
      if (error.status === 409) {
        try { inspectConflict(await loadBridgeBoard(token,request)); return; }
        catch (readError) { error=readError; }
      }
      if ([401,403].includes(error.status)) {
        needsPairing = true;report('请重新连接这台 Mac');
      } else {
        retryDelay=Math.min(Math.max(retryDelay*2,10000),60000);
        report('修改已保留，等待重试');
      }
    } finally { uploading=false;schedule(retryDelay); }
  }
  return {
    connection:()=>token,
    pendingBoard:()=>pending?.board,
    changed,
    async connect(value) {
      const current = await loadBridgeBoard(value,request);
      storage.setItem(tokenKey,value);token=value;needsPairing=false;
      useOnlineBaseline(current);
      report('自动同步已开启');changed(getData());schedule(0);
    },
    disconnect() {
      clearTimeout(timer);token='';storage.removeItem(tokenKey);
      conflictRevision=null;
      report('自动同步已关闭');
    },
    start() {
      if (!token) return;
      // An interrupted response may already have reached GitHub.
      if (pending && acknowledged === boardFingerprint(pending.board)) {
        pending=null;persist();
      }
      report(pending ? '等待同步' : release ? '已同步到线上' : '自动同步已开启');schedule(0);
    },
    retry() { if (!uploading) schedule(0); },
    async publishLocalVersion() {
      if (uploading || !conflictRevision || !pending || !token) return;
      const reviewed=conflictRevision;
      uploading=true;
      try {
        const latest=await loadBridgeBoard(token,request);
        if (latest.revision===reviewed && boardFingerprint(latest.board)!==boardFingerprint(pending.board)) {
          rebaseDraft(latest);retryDelay=0;report('等待同步');
        } else inspectConflict(latest);
      } catch { report('暂时无法核对线上版本，本机修改已保留'); }
      finally { uploading=false;schedule(retryDelay); }
    },
    dispose() { clearTimeout(timer); }
  };
}

export function mountAutoSync({key, release, dataKey, getData, notify}) {
  const container=document.querySelector('#settingsDialog .settings-links');
  const button=document.createElement('button');
  const detail=document.createElement('p');
  const resolve=document.createElement('button');
  resolve.textContent='发布本机版本';resolve.hidden=true;
  const badge=document.createElement('button');
  badge.className='save-status';badge.id='syncStatus';
  badge.onclick=()=>document.getElementById('settingsDialog').showModal();
  document.getElementById('saveStatus').after(badge);
  const sync=createAutoSync({key,release,getData,baseline:cachedBoardRevision(localStorage,dataKey),
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
  detail.textContent=sync.connection()?'编辑后自动发布到原网址。':'连接后，项目内容、分组与布局会自动发布到原网址。';
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
