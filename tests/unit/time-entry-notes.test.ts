import { describe, it, expect } from 'vitest';
import { noteToBullets } from '../../src/api/time-entry-notes.js';

// Every fixture marked "live" is a verbatim note from the sandbox org, taken
// from a 600-entry sample. That sample is also why the converter does not try to
// handle nested lists: there were none.
describe('noteToBullets', () => {
  it('turns one list into one bullet per item', () => {
    expect(
      noteToBullets('<ul><li><p>Erste Aufgabe</p></li><li><p>Zweite Aufgabe</p></li></ul>'),
    ).toEqual(['Erste Aufgabe', 'Zweite Aufgabe']);
  });

  it('flattens two consecutive <ul> blocks into one list (live: entry 138732468)', () => {
    const note =
      '<ul><li><p>Abstimmung BCX V2 API Spec</p></li></ul>' +
      '<ul><li><p>ESM Ticketeinführung</p></li></ul>';

    expect(noteToBullets(note)).toEqual(['Abstimmung BCX V2 API Spec', 'ESM Ticketeinführung']);
  });

  it('drops a trailing empty paragraph instead of emitting a blank bullet (live)', () => {
    const note = '<ul><li><p>#53678 Sortierlogik umstellen</p></li></ul><p></p>';

    expect(noteToBullets(note)).toEqual(['#53678 Sortierlogik umstellen']);
  });

  it('drops a paragraph that holds only a non-breaking space', () => {
    expect(noteToBullets('<ul><li><p>Echt</p></li></ul><p>&nbsp;</p>')).toEqual(['Echt']);
  });

  it('treats a note with no markup at all as a single bullet (live)', () => {
    const note = '#51985 [Etikettendruck] VVG-Artikel: Preis auf Etikett unterdrücken';

    expect(noteToBullets(note)).toEqual([note]);
  });

  it('keeps every item of a long list (live: 13 items on entry 153488335)', () => {
    const items = Array.from({ length: 13 }, (_, index) => `IT06315${index}`);
    const note = `<ul>${items.map((item) => `<li><p>${item}</p></li>`).join('')}</ul>`;

    expect(noteToBullets(note)).toEqual(items);
  });

  it('returns an empty array for an absent or blank note', () => {
    expect(noteToBullets(undefined)).toEqual([]);
    expect(noteToBullets(null)).toEqual([]);
    expect(noteToBullets('')).toEqual([]);
    expect(noteToBullets('   ')).toEqual([]);
    expect(noteToBullets('<p></p>')).toEqual([]);
  });

  it('decodes the entities Productive emits', () => {
    const note =
      '<ul><li><p>Release 4.31 &amp; Nacharbeiten</p></li><li><p>a &lt; b &gt; c</p></li></ul>';

    expect(noteToBullets(note)).toEqual(['Release 4.31 & Nacharbeiten', 'a < b > c']);
  });

  // The regression the decode ORDER exists for: resolving &amp; first would turn
  // this into "<", silently rewriting text the author escaped on purpose.
  it('does not double-decode an escaped entity', () => {
    expect(noteToBullets('<p>&amp;lt;</p>')).toEqual(['&lt;']);
  });

  it('strips tags it does not know and collapses inner whitespace', () => {
    expect(noteToBullets('<ul><li><p>Zeile<br>eins\n\tund   zwei</p></li></ul>')).toEqual([
      'Zeile eins und zwei',
    ]);
  });

  // A note that could contain a newline could forge a line of its own in any
  // report built from these strings.
  it('never returns a bullet containing a newline', () => {
    const bullets = noteToBullets('<ul><li><p>a\nb</p></li></ul>');

    expect(bullets).toEqual(['a b']);
    expect(bullets.some((line) => line.includes('\n'))).toBe(false);
  });

  it('handles the richer markup line item descriptions carry', () => {
    const description =
      '<div class="prose-mirror-html"></div><p>Solution Engineer POS (Remote)</p>';

    expect(noteToBullets(description)).toEqual(['Solution Engineer POS (Remote)']);
  });
});
