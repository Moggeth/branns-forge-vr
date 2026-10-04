// Bundles every patch-notes/YYYY-MM-DD-*.md entry into the client (Vite only; tests read the folder directly).
import {parsePatchNote} from './patch-notes.js';

const files = import.meta.glob('../patch-notes/20*.md', {query: '?raw', import: 'default', eager: true});

export const PATCH_NOTE_ENTRIES = Object.entries(files).flatMap(([path, text]) => {
  try { return [parsePatchNote(path, text)]; } catch (err) { console.warn(err.message); return []; }
});
