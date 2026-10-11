# Depop Listing Tool: Coding Plan

A command-line tool for Depop. You give it a folder of item photos plus short notes, and it gives back:

1. **Photos checked and corrected** to match the look of your shop (exposure, white balance, square crop), plus a warning for any photo that should be reshot.
2. **Listings written in your shop's voice**: description, brand, category, size, condition, colour, hashtags and a suggested price.
3. **A spreadsheet export.** For now it's a general CSV. Once your blue tick arrives, it becomes Depop's bulk-upload CSV.

It doesn't log into Depop or automate the Depop website. That would break Depop's terms. You stay in control of the final upload.

---

## 1. How it works

```
             ┌──────────────────────┐
 past        │  learn-style         │──► style/style_guide.md   (you can edit it)
 listings ──►│  (Claude + Pillow)   │──► style/examples.json    (best few-shot examples)
             └──────────────────────┘──► style/photo_profile.json (target brightness, colour, crop)

             ┌──────────────────────┐
 items/      │  photos              │──► items/<id>/processed/*.jpg
 <id>/*.jpg─►│  check + correct     │──► items/<id>/photo_report.json  (reshoot warnings)
 notes.txt   └──────────────────────┘
                      │
             ┌──────────────────────┐
             │  generate            │──► items/<id>/listing.json
             │  (Claude vision +    │
             │   structured output) │
             └──────────────────────┘
                      │
             ┌──────────────────────┐
             │  review  (HTML page) │──► you edit and approve
             └──────────────────────┘
                      │
             ┌──────────────────────┐
             │  export              │──► out/listings.csv  /  out/depop_bulk.csv
             └──────────────────────┘
                      │
             ┌──────────────────────┐
 sales.csv ─►│  feedback            │──► updates examples.json with what actually sells
             └──────────────────────┘
```

## 2. Tech stack

| Need | Choice | Why |
|---|---|---|
| Language | Python 3.11+ | Easiest to read and change; good image libraries |
| AI | Anthropic Python SDK (`anthropic`), model `claude-opus-5-5` | Reads photos and returns structured JSON |
| Structured output | `client.messages.parse(..., output_format=Listing)` with Pydantic | Every listing comes back in the same validated shape, so there's no text parsing |
| Prompt caching | `cache_control` on the system prompt (style guide + examples) | The style guide is sent with every item; caching makes the repeats much cheaper |
| Bulk runs | Message Batches API | 50% cheaper for large batches; results come back within minutes to hours |
| Images | Pillow (+ numpy) | Measuring and correcting brightness and colour, square crop, resize |
| CLI | `typer` | Simple commands: `depop learn-style`, `depop run`, and so on |
| Review UI | One generated static HTML file | No server needed; opens in any browser |
| Tests | `pytest` | AI calls are mocked so tests are free and repeatable |

**Cost estimate:** about 5 photos plus notes per item comes to roughly **5¢ per item** on `claude-opus-5-5` at $4 / $20 per million tokens, and about half that with the Batch API. So 100 items is about $3–5. Switching to `claude-haiku-5-5` would be much cheaper but may be less accurate, so it's a setting you can change later.

## 3. Folder layout

```
jj/
├── PLAN.md
├── pyproject.toml
├── .env.example               # ANTHROPIC_API_KEY=...
├── depop_tool/
│   ├── cli.py                 # typer commands
│   ├── models.py              # Pydantic: Listing, PhotoReport, StyleGuide
│   ├── style.py               # learn-style
│   ├── photos.py              # measure / correct / crop / flag
│   ├── generate.py            # Claude call per item (+ batch mode)
│   ├── validate.py            # rule checks on generated listings
│   ├── review.py              # build review.html
│   ├── export.py              # CSV writers + Depop column mapping
│   ├── feedback.py            # sales.csv → re-rank examples
│   └── prompts/
│       ├── learn_style.md
│       └── generate_listing.md
├── style/
│   ├── past_listings/         # your old listings (txt + screenshots), plus outcomes.csv
│   ├── style_guide.md         # generated, then edited by you
│   ├── examples.json
│   └── photo_profile.json
├── items/
│   └── 014-levis-jacket/
│       ├── 1.jpg 2.jpg ...
│       └── notes.txt          # "pit to pit 22in, length 26in, mark on cuff, $45"
├── config/
│   └── depop_columns.yaml     # filled in when you get Depop's template
├── out/
└── tests/
```

## 4. Modules in detail

### 4.1 `learn-style`: learn your shop's style

**Input:** `style/past_listings/` holds 10–20 of your old listings, each one a `.txt` with the description plus the cover photo. `outcomes.csv` gives `id, sold (y/n), days_to_sell, likes, price`.

**Steps:**
1. **Writing style (Claude):** send all the listing texts with their outcomes and ask for a style guide covering tone, layout order, how measurements are written, emoji use, common phrases, hashtag habits, and a "do / don't" list. Patterns from fast sellers count for more.
2. **Pick few-shot examples:** choose the 5–8 best listings (the fastest sellers, across a variety of item types) and save them to `examples.json`.
3. **Photo style (Pillow + Claude):** for each cover photo, measure:
   - mean brightness (L channel in LAB colour space)
   - contrast (spread of the brightness values)
   - colour cast (average a\*/b\* in LAB, i.e. how warm or cool the photo is)
   - background colour (the median of the border pixels)
   - aspect ratio
   - sharpness (variance of a Laplacian/edge filter)

   Then ask Claude to describe the look of the cover photos, such as "flat lay on a white sheet, overhead, soft daylight". Save the target numbers and allowed ranges in `photo_profile.json`.
4. **You check `style_guide.md`** and edit it by hand. That file is what the generator follows, so your edits always win.

### 4.2 `photos`: check and correct lighting

For each `items/<id>/*.jpg`:

1. Fix rotation using the photo's EXIF data and remove location data (privacy).
2. **Measure** the same numbers as in 4.1 and compare them with `photo_profile.json`.
3. **Correct automatically, gently:**
   - Brightness: a gamma/levels adjustment toward the target L value.
   - White balance: shift a\*/b\* toward the profile using the background as a neutral reference.
   - Contrast: a mild curve.
   - A square 1:1 crop centered on the item. A first version can trim the background border; Claude can also return a bounding box for a smarter crop.
   - Resize to about 1280×1280 and save as JPEG at about 90% quality in `processed/`.
4. **Flag photos instead of fixing them** when a correction would have to be large: very dark, highlights blown out, a strong colour cast, blurry, or harsh shadows (lots of very dark pixels in only part of the frame). Each warning in `photo_report.json` comes with a plain tip, like "move closer to the window" or "turn off the ceiling light".
5. **Optional check by Claude:** send the cover photo and ask whether the whole item is visible, the background is clean, and the photos include the tags and any flaws. Claude can also suggest the photo order based on your shot list.
6. **`depop lighting-check test.jpg`:** take one test shot before a photo session to check your setup in seconds.

> **Keep colours honest:** corrections are capped so an item never looks a different colour than it really is. This avoids "not as described" returns. The tool never edits out flaws.

### 4.3 `generate`: write the listing

Each item gets one call to Claude:

- **System prompt (cached):** the rules, `style_guide.md` and `examples.json`. It's identical for every item, so after the first item it's billed at the much cheaper cached-read rate.
- **User message:** 3–5 processed photos, each downscaled to save tokens, plus `notes.txt`.
- **Output:** a Pydantic `Listing` model, so the response is always valid JSON:

```python
class Listing(BaseModel):
    description: str            # in your voice; first line = searchable keywords
    brand: str | None
    category: str               # e.g. "Menswear > Jackets"
    size_label: str             # what the tag says
    fit_note: str | None        # "fits like S/M"
    measurements: dict[str, str]  # copied from notes, never invented
    condition: Literal["brand_new", "like_new", "excellent", "good", "fair"]
    colours: list[str]          # max 2
    style_tags: list[str]       # e.g. vintage, y2k, streetwear
    hashtags: list[str]         # max 5
    suggested_price: float
    price_reason: str
    flaws: list[str]
    photo_order: list[str]      # file names, cover first
    missing_info: list[str]     # questions for you, e.g. "material not visible on tag"
    confidence: Literal["high", "medium", "low"]
```

Rules for the prompt:
- Take measurements, flaws and price only from your notes. Never make them up.
- If the brand or material isn't readable in the photos, put it in `missing_info` instead of guessing.
- Follow the style guide. When the style guide and general best practice disagree, the style guide wins.

**Batch mode:** `depop run --batch` sends all items through the Message Batches API at half price. It saves a job ID, so you can close your laptop and run `depop fetch` later.

### 4.4 `validate`: check each listing automatically

Code checks run on every generated listing, and any failure is flagged in the review page:
- Description length is within Depop's limit.
- No more than 5 hashtags, and no duplicates.
- Every number in `measurements` appears in `notes.txt`, which catches made-up measurements.
- The price matches your note if you wrote one.
- Required fields are filled in.
- No banned words or keyword spam (a list you can edit).

### 4.5 `review`: your approval step

`out/review.html` shows one card per item:
- photo thumbnails in the suggested order
- every field, editable
- warnings from the photo checks and the validation step
- copy buttons for using it now, before the bulk upload
- an approve checkbox

Saving downloads `approved.json`, which the export reads. Your edits are also stored as before/after pairs, which feedback (4.7) uses to learn from your corrections.

### 4.6 `export`: the spreadsheet

- **Now:** `out/listings.csv` with general columns, which you can open in Google Sheets.
- **Blue tick:** download Depop's Google Sheet template from Selling Hub, then write its column headers into `config/depop_columns.yaml`. That file maps each Depop column to a `Listing` field, plus value translations such as `excellent → "Excellent condition"`. `export --depop` then writes a CSV that uploads as-is. If Depop changes its template, only the YAML needs changing.
- Processed photos are copied to `out/photos/<id>/01.jpg, 02.jpg …` so attaching photos to each draft is quick.

### 4.7 `feedback`: learn from sales

- You keep `sales.csv` with `id, listed_date, likes_7d, sold_date, final_price`.
- `depop feedback` does the following:
  - re-ranks `examples.json` so the fastest sellers become the few-shot examples
  - prints simple patterns, like average days to sell by category, price band and photo style
  - lists items with no likes after 10 days, with suggested fixes (a new cover photo, a new first line, or a lower price)
- Your edits from the review step can be folded back into `style_guide.md` (Claude proposes a diff, and you accept it or not).

## 5. Build order

| # | Milestone | Done when |
|---|---|---|
| M0 | Set up: `pyproject.toml`, CLI skeleton, `.env` with API key, `pytest` running | `depop --help` works |
| M1 | `learn-style` writing part | Gives a `style_guide.md` you agree sounds like you |
| M2 | `generate` for **one** item, plus `validate` | Re-creating 5 of your **past** listings from their photos gives text you'd post with small edits (this is the test of whether it works) |
| M3 | `photos` measure + correct + flag, `lighting-check` | Corrected photos look closer to your best covers; bad shots get flagged |
| M4 | Batch run, `review.html`, general CSV export | 10 real items go from folder to approved CSV in under 15 minutes |
| M5 | Depop CSV mapping (once you have the template) | The CSV uploads to Depop Drafts with no errors |
| M6 | `feedback` loop | Examples re-rank from `sales.csv` |

M1 and M2 save the most time, so they come first. The photo work (M3) is useful but optional at first.

## 6. Testing

- **Unit tests:** use generated test images (e.g. a dark grey square or a yellow-tinted square) to check that measuring and correcting behave as expected. Validation rules get their own tests, as does the CSV column mapping.
- **Mocked AI calls:** tests use saved responses, so they cost nothing and give the same result every run.
- **Quality test set:** `tests/golden/` holds 5–10 past items with your real listings. A script regenerates them and prints them next to the originals, so you can tell whether a prompt change helped.

## 7. Risks

| Risk | What we do about it |
|---|---|
| Depop's CSV columns aren't known yet | The YAML mapping is separate from the code, so it's a 10-minute change once you have the template |
| AI guesses a brand, material or measurement wrong | `missing_info` and `confidence` fields, number checks in `validate`, and a required human review step |
| Colour correction misrepresents the item | Corrections are capped; photos needing big fixes are flagged for a reshoot |
| Account risk from automation | No logging into Depop and no scraping. Only CSV export plus your manual upload |
| API key leaks | Key kept in `.env` (gitignored), never committed |
| Style drifts toward generic AI writing | Few-shot examples come from your real listings, and the style guide is edited by you |

## 8. What's needed from you

1. 10–20 past listings (text and cover photo) with outcomes: sold or not, days to sell, likes.
2. One real item folder (photos and `notes.txt`) to build and test against.
3. An Anthropic API key from console.anthropic.com.
4. When your blue tick arrives: Depop's bulk-upload Google Sheet template.
