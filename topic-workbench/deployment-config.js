import {publicationStore} from './board-publication.js';

export const deployment = {"public": true, "namespace": "topic-canvas-share-v1", "publishedAt": "2026-11-05T02:40:37.816811+00:00"};
export const boardPublication = publicationStore(deployment, {
  edition: globalThis.document?.querySelector('meta[name="board-edition"]')?.content,
  requested: new URLSearchParams(globalThis.location?.search).get('draft'),
  disk: () => globalThis.localStorage
});
export const storageKey = key => boardPublication.key(key);
