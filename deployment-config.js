import {publicationStore} from './board-publication.js';

export const deployment = {public:false, namespace:'topic-workbench-demo', releaseRawUrl:'', releaseApiUrl:''};
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
