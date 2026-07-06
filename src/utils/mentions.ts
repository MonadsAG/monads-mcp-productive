import { ProductiveAPIClient } from '../api/client.js';
import { ProductivePerson } from '../api/types.js';

/**
 * Matches @FirstName or @First Last (up to 3 capitalized words). Each word
 * may contain an internal apostrophe or hyphen (e.g. O'Brien, Anne-Marie) so
 * those names aren't dropped or truncated mid-token.
 * Won't match already-resolved @[{...}] patterns or @lowercase.
 */
const MENTION_REGEX =
  /@([A-Z][a-zA-Z]*(?:['-][A-Za-z]+)*(?:\s[A-Z][a-zA-Z]*(?:['-][A-Za-z]+)*){0,2})/g;

export interface MentionToken {
  raw: string;
  name: string;
  startIndex: number;
  endIndex: number;
}

export interface ResolvedMention {
  token: MentionToken;
  person: ProductivePerson;
  replacement: string;
}

export interface MentionResolutionResult {
  resolvedBody: string;
  resolved: ResolvedMention[];
  unresolved: MentionToken[];
  ambiguous: Array<{ token: MentionToken; candidates: ProductivePerson[] }>;
}

export function extractMentionTokens(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let match: RegExpExecArray | null;

  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(body)) !== null) {
    tokens.push({
      raw: match[0],
      name: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return tokens;
}

export function buildMentionReplacement(person: ProductivePerson): string {
  const mention = {
    type: 'person',
    id: person.id,
    label: `${person.attributes.first_name} ${person.attributes.last_name}`.trim(),
    avatar_url: person.attributes.avatar_url || null,
    attachment_url: null,
    is_done: false,
  };
  return `@[${JSON.stringify(mention)}]`;
}

function matchPerson(name: string, people: ProductivePerson[]): ProductivePerson[] {
  const lowerName = name.toLowerCase();

  const fullMatches = people.filter((p) => {
    const fullName = `${p.attributes.first_name} ${p.attributes.last_name}`.trim().toLowerCase();
    return fullName === lowerName;
  });

  if (fullMatches.length > 0) return fullMatches;

  if (!name.includes(' ')) {
    return people.filter((p) => p.attributes.first_name.toLowerCase() === lowerName);
  }

  return [];
}

/** Safety cap on pages fetched when resolving mentions, to bound worst-case org sizes. */
const MAX_MENTION_LOOKUP_PAGES = 10;

/** Fetches every person in the org (paginated), up to MAX_MENTION_LOOKUP_PAGES pages. */
async function listAllPeople(client: ProductiveAPIClient): Promise<ProductivePerson[]> {
  const people: ProductivePerson[] = [];
  let page = 1;

  while (page <= MAX_MENTION_LOOKUP_PAGES) {
    const response = await client.listPeople({ limit: 200, page });
    people.push(...(response.data || []));

    const totalPages = response.meta?.total_pages ?? page;
    if (page >= totalPages) break;
    page += 1;
  }

  return people;
}

export async function resolveMentions(
  body: string,
  client: ProductiveAPIClient,
): Promise<MentionResolutionResult> {
  const tokens = extractMentionTokens(body);

  if (tokens.length === 0) {
    return { resolvedBody: body, resolved: [], unresolved: [], ambiguous: [] };
  }

  const people = await listAllPeople(client);

  const resolved: ResolvedMention[] = [];
  const unresolved: MentionToken[] = [];
  const ambiguous: Array<{ token: MentionToken; candidates: ProductivePerson[] }> = [];

  for (const token of tokens) {
    const matches = matchPerson(token.name, people);

    if (matches.length === 1) {
      resolved.push({
        token,
        person: matches[0],
        replacement: buildMentionReplacement(matches[0]),
      });
    } else if (matches.length > 1) {
      ambiguous.push({ token, candidates: matches });
    } else {
      unresolved.push(token);
    }
  }

  if (ambiguous.length > 0) {
    return { resolvedBody: body, resolved: [], unresolved, ambiguous };
  }

  let resolvedBody = body;
  for (const r of [...resolved].reverse()) {
    resolvedBody =
      resolvedBody.slice(0, r.token.startIndex) +
      r.replacement +
      resolvedBody.slice(r.token.endIndex);
  }

  return { resolvedBody, resolved, unresolved, ambiguous };
}
