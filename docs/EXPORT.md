# Export format

The Export page (`/brands/<id>/export`) builds one ZIP for a date range. Only **approved** posts (and posts already exported before) are included; every included post and variant is then marked `exported`. Past exports stay downloadable on the same page.

## ZIP layout

```
<brand-slug>_<from>_<to>/
  README.txt
  posts_generic.csv
  metricool_bulk_upload.csv
  2026-12-03/
    instagram_id/        # "_<language>" only when the brand has more than one language
      slide_01.png       # carousels: slide_01, slide_02, … in posting order
      slide_02.png
      caption.txt        # title (YouTube) + caption + hashtags
    linkedin_id/
      image.png          # single image
      caption.txt
    tiktok_id/
      storyboard.md      # video posts: a text plan (hook, script, shots, Veo/Kling prompts). No video file.
      caption.txt
```

Images are PNG at the exact platform size. A TEST brand's images carry the yellow TEST mark. If an approved image variant has no rendered image, the export stops and names the variants to re-render.

## CSV rules (both files)

UTF-8 with BOM (so Excel shows accents and emoji), every field quoted, quotes doubled, CRLF line ends.

## posts_generic.csv

One row per platform variant, including storyboards.

| Column | Content |
| --- | --- |
| date | Posting date (YYYY-MM-DD) |
| time | Local posting time from `config/platforms.json` (`defaultTime`) |
| platform | instagram, tiktok, youtube_shorts, facebook, linkedin, x_threads |
| language | Language code |
| format | single_image, carousel, document_carousel, video_storyboard, … |
| width, height | Pixel size |
| caption | Caption without hashtags |
| hashtags | Space-separated |
| full_text | Caption + blank line + hashtags (what to paste) |
| title | YouTube title, else empty |
| cta | Call to action |
| file_names | Paths inside the ZIP, separated by ` \| ` |
| folder | Folder inside the ZIP |
| note | e.g. "Storyboard — video not rendered" |

## metricool_bulk_upload.csv

One row per **image** variant (storyboards are left out: there is no media to schedule). Each row enables exactly one network column (`TRUE`), all others `FALSE`. Rows import as drafts (`Draft` = `TRUE`) so nothing publishes without a look in Metricool.

Columns, in order: `Text`, `Date`, `Time`, `Draft`, `Facebook`, `Twitter`, `LinkedIn`, `GMB`, `Instagram`, `Pinterest`, `TikTok`, `Youtube`, `Threads`, `Bluesky`, `Picture Url 1` … `Picture Url 10`, `Instagram Post Type` (POST or CAROUSEL), `Facebook Post Type` (POST), `Youtube Video Title`, `LinkedIn Type` (POST or DOCUMENT).

Platform mapping: instagram → Instagram, tiktok → TikTok, youtube_shorts → Youtube, facebook → Facebook, linkedin → LinkedIn, x_threads → Twitter.

Metricool imports media from public URLs. Set `PUBLIC_MEDIA_BASE_URL` to where the ZIP's folders are hosted (for example an S3 bucket or a static site) and the picture columns become `<base>/<date>/<platform>/<file>`. Without it they hold paths inside the ZIP, and the media must be attached in Metricool by hand.

**Check before first use:** these column names follow Metricool's bulk-upload template as we know it; Metricool changes its template from time to time and the template could not be downloaded while building NOVRA. Download the current template from Metricool (Planning → Bulk upload) and compare the header row. If it differs, change `METRICOOL_HEADERS` and the row builder in `src/lib/export/export.ts`; the test `tests/step7-export.test.ts` checks the file against those headers.
