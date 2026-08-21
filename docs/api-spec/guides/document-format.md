<!-- Mirrored from https://developer.productive.io/guides/document-format -- regenerate with `npm run spec:guides` -->

The Productive Document Format describes the elements supported in rich text fields like `pages.body`. It defines what you can write through the Markdown and HTML proxy endpoints documented in [Importing Docs via API](https://developer.productive.io/importing_docs_via_api.html).

It's currently used in the following resources:

| Resource | Property | Description |
| -------- | -------- | ----------- |
| `pages`  | `body`   | Productive Docs are represented by the `pages` resource and its `body` is written and read in this format |

### How content is sent

The content shown in this guide goes into the `markdown` or `html` field of a proxy endpoint request. For example, to append the content to a page:

Markdown path:

```json
PATCH /api/v2/pages/:id/append_markdown
{
  "markdown": "## Daily standup\n\n- Build is green"
}
```

HTML path:

```json
PATCH /api/v2/pages/:id/append_html
{
  "html": "<h2>Daily standup</h2><ul><li>Build is green</li></ul>"
}
```

When creating a page, the field lives inside the standard JSON:API envelope alongside the other page attributes (`title`, `project_id`, …):

```json
POST /api/v2/pages/create_with_markdown
{
  "data": {
    "type": "pages",
    "attributes": {
      "title": "Sprint planning",
      "project_id": 12345,
      "markdown": "# Sprint 42\n\n- Ship the dashboard"
    }
  }
}
```

For full request examples (headers, response shapes, append vs replace, error pitfalls), see [Importing Docs via API](https://developer.productive.io/importing_docs_via_api.html). The rest of this guide describes what you can put inside the `markdown` and `html` strings.

### Supported nodes and marks

**Block elements:** `paragraph`, `blockquote`, `heading`, `codeblock`, `ol`, `ul`, `checklist`, `table`, `divider`, `banner`, `columns`

**Inline elements:** `text`, `image`, `file`, `mention`, `var`, `br`

**Marks (text formatting):** `link`, `em`, `strike`, `underline`, `strong`, `code`, `discussion`, `styles`

### Node types

**Paragraph**

Plain text separated by blank lines. The Markdown form is the default — no syntax. The HTML form supports optional `style="text-align: left|center|right|justify"`.

```html
<p>Hello world.</p>
<p style="text-align: center">Centered text.</p>
```

**Blockquote**

Markdown: `> Hello world`

HTML: `<blockquote><p>Hello world</p></blockquote>`

**Heading**

Three levels are supported. Markdown: `#`, `##`, `###`. HTML: `<h1>`, `<h2>`, `<h3>`. Higher levels (`####` / `<h4>` and below) are not rendered.

**Codeblock**

A fenced code block with an optional language hint. The HTML form uses the `codeblock-language` attribute.

````markdown
```ruby
puts 'hello'
```
````

```html
<pre codeblock-language="ruby"><code>puts 'hello'</code></pre>
```

**Ordered list**

Markdown: `1. item`. HTML: `<ol>` of `<li>` items. The HTML form supports `<ol start="N">` to change the starting number.

**Unordered list**

Markdown: `- item`. HTML: `<ul>` of `<li>` items.

**Checklist**

Markdown uses GFM task list syntax inside list items:

```markdown
- [ ] To do
- [x] Done
```

HTML uses dedicated attributes:

```html
<ul type="checklist">
  <li type="checklist_item" checked="false"><p>To do</p></li>
  <li type="checklist_item" checked="true"><p>Done</p></li>
</ul>
```

**Table**

Markdown supports the standard GFM table form (header row + delimiter row + body rows). HTML is required for cell `colspan`, `rowspan`, alignment, and background color.

```html
<table>
  <tr>
    <th>Item</th>
    <th colspan="2">Range</th>
  </tr>
  <tr>
    <td>A</td>
    <td style="text-align: right">10</td>
    <td style="background-color: #fef3c7">20</td>
  </tr>
</table>
```

**Divider**

Markdown: `---` on its own line. HTML: `<hr>`.

**Banner**

A callout block. **HTML only** — Markdown has no equivalent. Supported `type` values: `info`, `warning`, `success`, `critical`.

```html
<banner type="warning"><p>This is a banner</p></banner>
```

**Columns**

Multi-column layout, 2 to 5 columns. **HTML only**.

```html
<div data-columns data-column-count="2" style="grid-template-columns: 1fr 1fr;">
  <div data-column><p>Left</p></div>
  <div data-column><p>Right</p></div>
</div>
```

**Image**

Markdown: `![alt](url "title")`. HTML form additionally supports `width`:

```html
<img src="https://example.com/image.png" alt="alt text" title="title" width="100">
```

**File**

A link to an uploaded file. **HTML only**.

```html
<span file-type="application/pdf"
      url="https://files.productive.io/.../report.pdf"
      name="Q1 report.pdf">Q1 report.pdf</span>
```

**Mention**

A reference to a Productive object — a person, task, page, project, etc. — that renders as a mention pill and triggers notifications when applicable. **HTML only**; Markdown stores `@username` as literal text.

```html
<p>Hi <span mention-type="user" mention-id="12345" mention-label="John Doe">John Doe</span>, please review.</p>
```

| Attribute | Required | Description |
| --------- | -------- | ----------- |
| `mention-type` | ✓ | `user`, `task`, `page`, `project`, `deal`, `company`, … |
| `mention-id` | ✓ | Numeric id of the referenced object |
| `mention-label` | ✓ | Display text shown inside the pill |
| `mention-avatar-url` |   | Avatar URL (used for `user` mentions) |

The HTML path also accepts a compact shorthand that is expanded into the structured node automatically:

```
@[type:id:label]
```

For example, `@[user:12345:John Doe]` is equivalent to the `<span>` form above.

**Variable**

An inline placeholder rendered as `{var_name}` in the editor and resolved by other parts of Productive at display time. **HTML only**.

```html
<p>Hello <span var="customer_name"></span>, your invoice is ready.</p>
```

**Line break**

A line break inside a paragraph (as opposed to a paragraph break). Markdown: end the line with two trailing spaces. HTML: `<br>`.

### Mark types

**Bold**, **italic**, **strike-through**, **inline code**, and **link** use standard Markdown / HTML syntax — `**bold**` / `<strong>`, `*italic*` / `<em>`, `~~strike~~` / `<del>`, `` `code` `` / `<code>`, `[text](url)` / `<a href>`. No Productive-specific quirks.

**Underline**

**HTML only** — Markdown has no syntax for underline.

```html
<u>Hello world</u>
```

**Discussion**

Highlights text and links it to a discussion thread. **HTML only**.

```html
<span discussion-id="1" resolved-id="">world</span>
```

**Styles**

Inline styling such as text color, background color, or font weight. **HTML only**.

```html
<span style="color: #ef4444; background-color: #fef3c7">Highlighted</span>
```
