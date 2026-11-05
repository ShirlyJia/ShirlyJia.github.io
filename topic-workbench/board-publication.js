// Public editions have separate working copies. The original key stays accessible
// as "legacy", including edits made in an older tab that's still open.
const versionPattern = /^\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/;
const boardKey = 'topic-workbench-v2';

export function publicationStore(deployment, {edition, requested, disk}) {
  const prefix = deployment.public ? deployment.namespace + ':' : '';
  const originalKey = prefix + boardKey;
  const versioned = deployment.public && versionPattern.test(edition);
  const keyFor = id => id === 'legacy' ? originalKey : originalKey + ':' + id;
  let active = edition;
  if (versioned && requested && (requested === 'legacy' || versionPattern.test(requested))) {
    // A draft link opened on another device should open the published board.
    try { if (disk().getItem(keyFor(requested)) !== null) active = requested; } catch {}
  }
  return {
    edition: versioned ? edition : null,
    active: versioned ? active : null,
    key(key) { return versioned && key === boardKey ? keyFor(active) : prefix + key; },
    olderCopies() {
      if (!versioned) return [];
      const ids = [];
      try {
        const storage = disk();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key === originalKey) ids.push('legacy');
          else if (key?.startsWith(originalKey + ':')) {
            const id = key.slice(originalKey.length + 1);
            if (id !== edition && versionPattern.test(id)) ids.push(id);
          }
        }
      } catch {}
      return ids.sort((a,b) => a === 'legacy' ? 1 : b === 'legacy' ? -1 : b.localeCompare(a));
    }
  };
}

export function showBoardCopies(container, publication) {
  if (!publication.edition) return;
  const previous = publication.active !== publication.edition;
  const ids = publication.olderCopies().filter(id => id !== publication.active);
  if (previous) ids.unshift(publication.edition);
  for (const id of ids) {
    const url = new URL(location.href);
    if (id === publication.edition) url.searchParams.delete('draft');
    else url.searchParams.set('draft', id);
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = id === publication.edition ? '返回最新发布版' : id === 'legacy' ? '打开更新前的本机画板' : '打开本机旧稿 · ' + id.slice(0,10);
    container.append(link);
  }
  if (previous) document.getElementById('openSettings').textContent = '⚙ 设置 · 本机旧稿';
}
