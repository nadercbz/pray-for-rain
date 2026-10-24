// Sprache des Spiels: Englisch (Standard) oder Deutsch. Jeder sichtbare Text steht direkt im Code als L('Deutsch', 'English').
// Gewählt wird im Menü (Einstellungen), gespeichert in localStorage 'pfr.lang', ein Wechsel lädt die Seite neu.
// In Node (Tests) gilt PFR_LANG aus der Umgebung, sonst Englisch.
let lang = 'en';
try {
  // Node (Tests) zuerst: dort gibt es inzwischen auch ein leeres localStorage
  if (typeof process !== 'undefined' && process.env && process.env.PFR_LANG) lang = process.env.PFR_LANG;
  else if (typeof localStorage !== 'undefined' && localStorage) lang = localStorage.getItem('pfr.lang') || 'en';
} catch { /* ohne Speicher bleibt Englisch */ }
if (lang !== 'de' && lang !== 'en') lang = 'en';

export const LANG = lang;
export const L = (de, en) => (lang === 'de' ? de : en);
export function setLang(l) {
  try { localStorage.setItem('pfr.lang', l); } catch { /* egal */ }
  location.reload();
}
