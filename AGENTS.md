# Project purpose

This project records the user's favorite artwork and design, caches references where possible, and maintains a durable, evolving understanding of their taste.

## Automatic archiving of incoming references

- A bare artwork URL or attached image in this project is an instruction to archive it. Proceed without a questionnaire or another confirmation, unless the user says it is only for discussion or not to save it.
- Use `scripts/archive_reference.py` for every new import or enrichment. Read `scripts/README.md` for arguments and metadata. Do not write another one-off import script or hand-edit gallery counts.
- Read the catalog and style profile, then inspect the supplied page/image. For URLs, retrieve visible metadata and export only the relevant artwork images through available permitted tools (for example Browser `pageAssets.bundle`). The script accepts local assets and does not bypass browser/download restrictions.
- Save available original attachments. Pass verified metadata and exported files with `--metadata` and `--image`; set `image_inspected: true` only after actually viewing the picture. Preserve known credits and licenses. Do not fabricate unknown names, titles, dates, or observations.
- Check matching titles, creators, versions and pictures as well as the script's URL/hash checks. Use `--reference-id` to enrich the same work under a different URL. For a gallery, archive each distinct work; use `--new-record` only when a shared gallery URL would otherwise merge distinct works. Keep multiple views together; keep genuinely different versions distinct.
- If retrieval is blocked, run the script with the source URL and whatever metadata is known. Report `source-only` or `partial` honestly. Enrich the same record later when an image becomes available.
- Links saved outside chat with the Save to Art Inspo dialog (`scripts/paste_link.py`) arrive as `source-only` records whose `attribution_status` begins "Saved from the paste dialog". Their titles come from a browser tab or are placeholders and are unverified; their `user_comments` are the user's own. When the user asks to process or enrich new links, inspect each one and enrich it with `archive_reference.py --reference-id`, replacing the title and attribution status with verified values.
- After importing, review its JSON result and verify the saved asset/note. Update grounded preference observations in `STYLE_PROFILE.md` only when warranted; saving a reference does not mean every visual feature is a confirmed preference. The script updates the count line and the complete illustrated indexes automatically.
- Reply briefly with the saved work's title and a link to its note. This workflow runs when Codex receives a message in this project; it is not an unattended system-wide URL watcher.

## Collection workflow

- Read `catalog.json` and `STYLE_PROFILE.md` before adding references or making personalized design suggestions.
- When the user shares a reference for the collection, save available original attachments under `references/<reference-id>/`, preserve source URLs and known creator credits, and create a note using `references/TEMPLATE.md` as a guide.
- Use stable IDs such as `ref-0001`. Check the catalog for duplicates before creating entries.
- Cache remote assets only through available, permitted tool workflows; respect tool restrictions on downloading media. If caching is unavailable, save source metadata and notes and mark the entry `source-only` or `partial`. Never claim an asset is cached without a local file.
- Catalog entries should include ID, title, date added, source URL, creator if known, note path, local asset paths, cache status, and tags. Leave unknown attribution unknown.
- Inspect images before describing their visual qualities. Keep user comments separate from inferred preferences.
- Update `STYLE_PROFILE.md` when evidence supports a preference or recurring pattern. Cite reference IDs, distinguish explicit preferences from inferences, and retain uncertainty and exceptions.
- Do not claim to train or permanently change the underlying model. The collection and style profile provide persistent project context.
- Keep the process lightweight: accept references without requiring a questionnaire, and refine interpretations using later feedback.

## Website

- `index.html` renders the collection straight from `catalog.json` and `references/`; it needs no regeneration after an import. Keep catalog fields and asset paths accurate and the site follows. See `README.md` for serving and publishing.
