/**
 * A time entry's note is a small HTML document, not text.
 *
 * Productive's UI writes it through a rich-text editor, so `attributes.note`
 * comes back as markup: 197 of 200 sampled entries carried tags. Handing that
 * straight to a caller (which is what `list_time_entries` does today) puts
 * `<ul><li><p>` in front of a human and burns tokens on a model.
 *
 * The grammar is small and was measured, not assumed -- a 600-entry sample from
 * the sandbox contained only `<ul>`, `<li>` and `<p>`, no nesting, and only the
 * four entities `&amp; &lt; &gt; &nbsp;`. Three shapes in that sample are the
 * reason this is not a one-line `replace(/<[^>]+>/g, '')`:
 *
 *   1. Two consecutive `<ul>` blocks in one note (entry 138732468). They are one
 *      list to a reader, and a `<ul>`-aware parser is exactly what would split
 *      them in two.
 *   2. A trailing empty `<p></p>` (3 entries), which must not become a bullet.
 *   3. Plain text with no tags at all (3 entries), which must still yield one
 *      bullet rather than nothing.
 *
 * Line item descriptions carry a wider vocabulary (`<div class="...">`), so the
 * tag stripping has to tolerate attributes. This module is deliberately not
 * invoice-specific: `list_time_entries` is the obvious next caller.
 */

/**
 * Split a note into its bullet points.
 *
 * Returns `[]` for an absent or empty note -- callers render no list at all in
 * that case rather than an empty one.
 */
export function noteToBullets(note?: string | null): string[] {
  if (!note || !note.trim()) return [];

  // Scanning for `<li>` and `<p>` rather than walking `<ul>` is what flattens
  // two adjacent lists into one: their children are collected in document
  // order and the list wrapper is never looked at. Non-greedy `*?` is exact
  // here only because the sampled grammar has no nesting -- if Productive ever
  // starts emitting nested lists, this is the line that has to change.
  const blockPattern = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  const blocks = [...note.matchAll(blockPattern)].map((match) => match[2]);

  // No block markup at all: the whole note is one bullet.
  const candidates = blocks.length > 0 ? blocks : [note];

  return candidates.map(toPlainText).filter((line) => line.length > 0);
}

/** Strip markup, decode entities, and normalise whitespace to a single line. */
function toPlainText(fragment: string): string {
  // Tags first, entities second. The other order would turn a decoded `&lt;b&gt;`
  // into something the tag pattern then eats as markup.
  //
  // A tag becomes a space, not nothing: dropping a `<br>` outright welds the
  // words either side of it into `Zeileeins`, which is a worse error than the
  // extra space an inline tag would leave -- and the whitespace collapse below
  // removes that anyway.
  const withoutTags = fragment.replace(/<[^>]+>/g, ' ');

  // Collapsing whitespace is a safety property, not just cosmetics: it
  // guarantees a note cannot contain a newline, so note text can never forge a
  // line of its own in a rendered report.
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * Decode the entities Productive actually emits.
 *
 * `&amp;` MUST come last. Decoding it first turns the literal `&amp;lt;` into
 * `&lt;` and then into `<` -- a double decode that silently rewrites the text.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}
