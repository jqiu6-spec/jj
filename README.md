# jj

## Always Pan ad → "shot on iPhone 17"

`iphone_look.py` converts the clean CGI render in `source-ad.webp` into an image
that reads as a real photograph taken with an iPhone 17 main camera.
It simulates the phone's capture pipeline (lens geometry and chromatic
aberration, corner softness, vignetting, Smart-HDR-style tone, sensor grain,
chroma noise reduction, ISP sharpening, 4:2:0 JPEG) and writes real iPhone 17
EXIF metadata. Only numpy and Pillow are needed.

```
python3 iphone_look.py source-ad.webp output
```

Outputs in `output/`:

| file | what it is |
| --- | --- |
| `always-pan-iphone17.jpg` | main result: scene photographed, typography re-composited as crisp ad graphics (4032x2268, EXIF) |
| `always-pan-iphone17-printed-type.jpg` | alternate: the type goes through the camera too, as if the whole ad were a wall graphic photographed in place |
| `before-after.jpg` | source crop above, result below |
| `preview-overlay.jpg`, `detail-100pct.jpg` | quick-look preview and a 100% crop |
