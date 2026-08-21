<!-- Mirrored from https://developer.productive.io/guides/importing-docs-via-api -- regenerate with `npm run spec:guides` -->

Using Productive's API, you can efficiently import Docs (with text) into your account.

You send the content as Markdown or HTML, and Productive converts it into the internal document structure for you. For detailed documentation on the underlying structure, refer to the [Document Format](https://developer.productive.io/document_format.html) guide.


> Tip: Updates go through the realtime collaboration layer, so they are safe to run even while someone has the Doc open in the interface. Prefer **append** over **replace** when the page may be open — append cannot drop a teammate's unsynced edits.

### Creating New Docs

To create new docs, you'll interact with the `pages` endpoint.

**POST Endpoint:**

`POST https://api.productive.io/api/v2/pages/create_with_markdown`

You send the page body as a `markdown` attribute (alongside the usual page attributes — `title`, `project_id`, `parent_page_id`, etc.) inside the JSON:API `attributes` object.

```json
{
  "data": {
    "type": "pages",
    "attributes": {
      "title": "Sprint planning notes",
      "project_id": 12345,
      "markdown": "# Sprint 42\n\n- Ship the new dashboard\n- Reduce p99 latency\n"
    }
  }
}
```

### Updating Existing Docs

To write into an existing doc, use one of the four body-mutation endpoints:

| Method | Path | Purpose | Body |
| ------ | ---- | ------- | ---- |
| `PATCH` | `/api/v2/pages/:id/append_markdown` | Append markdown to the end | `{ "markdown": "..." }` |
| `PATCH` | `/api/v2/pages/:id/append_html` | Append HTML to the end | `{ "html": "..." }` |
| `PATCH` | `/api/v2/pages/:id/replace_body_with_markdown` | Replace the entire body with markdown | `{ "markdown": "..." }` |
| `PATCH` | `/api/v2/pages/:id/replace_body_with_html` | Replace the entire body with HTML | `{ "html": "..." }` |

These endpoints take a flat top-level body (`{ "markdown": "..." }` or `{ "html": "..." }`), **not** the JSON:API `data.attributes` envelope.

Markdown covers paragraphs, headings, lists, tables, code blocks, links, images, and basic emphasis. Use HTML when you need anything markdown has no syntax for — mentions, file attachments, banners, multi-column layouts, variables, underline, or styled text. For the supported node and mark types and their HTML/JSON shapes, refer to the [Document Format](https://developer.productive.io/document_format.html) guide.
