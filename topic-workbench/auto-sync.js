export const SYNC_ORIGIN = 'http://127.0.0.1:8768';
export const LIVE_BOARD_URL = 'https://api.github.com/repos/ShirlyJia/ShirlyJia.github.io/contents/topic-workbench/live-board.json?ref=topic-board-data';

export function boardFingerprint(board) {
  const {view, ...content} = board;
  return JSON.stringify(content);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {...options, signal:AbortSignal.timeout(15000), cache:'no-store'});
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || '无法读取线上画板');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function validateRelease(release) {
  if (!release || !/^[a-f0-9]{32}$/.test(release.revision) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(release.updatedAt) ||
      release.board?.schemaVersion !== 2 || !Array.isArray(release.board.projects)) {
    throw Error('线上画板格式不完整');
  }
  return release;
}

export async function loadSharedBoard({connection = '', publicSite = false} = {}) {
  if (connection) {
    try {
      return validateRelease(await jsonRequest(SYNC_ORIGIN + '/state', {
        headers:{Authorization:'Bearer ' + connection}
      }));
    } catch {}
  }
  if (!publicSite) return null;
  try {
    return validateRelease(await jsonRequest(
      'https://raw.githubusercontent.com/ShirlyJia/ShirlyJia.github.io/topic-board-data/topic-workbench/live-board.json?t=' + Date.now()));
  } catch {
    try {
      return validateRelease(await jsonRequest(LIVE_BOARD_URL + '&t=' + Date.now(), {
        headers:{Accept:'application/vnd.github.raw+json'}
      }));
    } catch { return null; }
  }
}

// Reuse one current copy. Preserve only unsubmitted edits when a newer release
// arrives, rather than filling browser storage with every published revision.
export async function prepareLiveStorage({storage, key, archivePrefix, release}) {
  const digest = async board => Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',new TextEncoder().encode(boardFingerprint(board))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const metaKey=key+':baseline', raw=storage.getItem(key);
  let meta=null;
  try { meta=JSON.parse(storage.getItem(metaKey)||'null'); } catch {}
  if (raw && meta?.revision !== release.revision) {
    // Parsing failures surface through normal persistence recovery; never erase.
    let previous;
    try { previous=JSON.parse(raw); } catch { return; }
    const previousFingerprint=await digest(previous);
    if (previousFingerprint !== meta?.fingerprint && previousFingerprint !== await digest(release.board)) {
      const oldEdition=meta?.edition || release.updatedAt.slice(0,10)+'-'+crypto.randomUUID().replaceAll('-','').slice(0,16);
      storage.setItem(archivePrefix+':'+oldEdition,raw);
    }
    storage.setItem(key,JSON.stringify(release.board));
  }
  storage.setItem(metaKey,JSON.stringify({revision:release.revision,
    edition:release.updatedAt.slice(0,10)+'-'+release.revision.slice(0,16),fingerprint:await digest(release.board)}));
}

export function createAutoSync({key, release, getData, status, storage = localStorage,
                               request = jsonRequest, delay = 5000}) {
  const tokenKey = key + ':connection', draftKey = key + ':pending';
  let token = storage.getItem(tokenKey) || '';
  let revision = release?.revision ?? null;
  let acknowledged = release ? boardFingerprint(release.board) : null;
  let pending = null, timer = null, uploading = false, stopped = false, retryDelay = delay;
  try {
    const saved = JSON.parse(storage.getItem(draftKey) || 'null');
    if (token && saved?.board?.schemaVersion === 2) pending = saved;
  } catch { status('待同步备份读取失败，请先导出画板'); }
  const report = text => status(text);
  function persist() {
    if (pending) storage.setItem(draftKey,JSON.stringify(pending));
    else storage.removeItem(draftKey);
  }
  function schedule(ms = delay) {
    clearTimeout(timer);
    if (token && pending && !stopped) timer = setTimeout(publish,ms);
  }
  function changed(board) {
    if (!token) return;
    const fingerprint = boardFingerprint(board);
    if (!pending && fingerprint === acknowledged) return;
    if (pending && fingerprint === boardFingerprint(pending.board)) return;
    pending = {board:structuredClone(board), baseRevision:pending?.baseRevision ?? revision};
    try { persist(); } catch { report('待同步内容保存失败，请导出备份'); return; }
    report('等待同步');schedule();
  }
  async function publish() {
    if (uploading || !pending || !token || stopped) return;
    uploading = true;
    const submitted = pending;
    report('正在同步…');
    try {
      const saved = validateRelease(await request(SYNC_ORIGIN + '/publish', {
        method:'POST',headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json'},
        body:JSON.stringify(submitted)
      }));
      revision = saved.revision; acknowledged = boardFingerprint(submitted.board);
      if (pending === submitted) pending = null;
      else pending.baseRevision = revision;
      persist();retryDelay=delay;
      report(pending ? '等待同步' : '已同步到线上');
    } catch (error) {
      if (error.status === 409) {
        stopped = true;
        report('线上有更新，自动同步已暂停');
      } else if ([401,403].includes(error.status)) {
        stopped = true;report('请重新连接这台 Mac');
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
      const current = validateRelease(await request(SYNC_ORIGIN + '/state', {
        headers:{Authorization:'Bearer ' + value}
      }));
      storage.setItem(tokenKey,value);token=value;revision=current.revision;
      acknowledged=boardFingerprint(current.board);stopped=false;
      report('自动同步已开启');changed(getData());schedule(0);
    },
    disconnect() {
      clearTimeout(timer);token='';storage.removeItem(tokenKey);
      report('自动同步已关闭');
    },
    start() {
      if (!token) return;
      // An interrupted response may already have reached GitHub.
      if (pending && acknowledged === boardFingerprint(pending.board)) {
        pending=null;persist();
      }
      report(pending ? '等待同步' : '自动同步已开启');schedule(0);
    },
    retry() { if (!stopped) schedule(0); },
    dispose() { clearTimeout(timer); }
  };
}

export function mountAutoSync({key, release, getData, notify}) {
  const container=document.querySelector('#settingsDialog .settings-links');
  const button=document.createElement('button');
  const detail=document.createElement('p');
  const badge=document.createElement('button');
  badge.className='save-status';badge.id='syncStatus';
  badge.onclick=()=>document.getElementById('settingsDialog').showModal();
  document.getElementById('saveStatus').after(badge);
  const sync=createAutoSync({key,release,getData,status:text=>{
    badge.textContent=text;badge.hidden=false;detail.textContent=text;
  }});
  button.textContent=sync.connection()?'关闭自动同步':'连接这台 Mac 自动同步';
  badge.hidden=!sync.connection();
  detail.textContent=sync.connection()?'编辑后自动发布到原网址。':'连接后，项目内容、分组与布局会自动发布到原网址。';
  container.prepend(button,detail);
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
  return sync;
}
