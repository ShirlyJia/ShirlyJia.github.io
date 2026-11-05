import {publicationStore} from './board-publication.js';

export const deployment = {"public": true, "namespace": "topic-canvas-share-v1", "publishedAt": "2026-11-05T04:46:09.654261+00:00"};
const publicationOptions = {
  edition: globalThis.document?.querySelector('meta[name="board-edition"]')?.content,
  requested: new URLSearchParams(globalThis.location?.search).get('draft'),
  disk: () => globalThis.localStorage
};
export let boardPublication = publicationStore(deployment, publicationOptions);
export function useBoardEdition(edition) {
  boardPublication = publicationStore(deployment, {...publicationOptions, edition});
}
export const storageKey = key => boardPublication.key(key);
