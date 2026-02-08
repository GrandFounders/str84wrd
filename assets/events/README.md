# Event type card videos

Add one **MP4 video** per event type for the Start Project swipe cards. Short looping clips work best and are more intuitive on mobile.

Place files here with these names (paths are relative to the site root):

| File | Event type |
|------|------------|
| `wedding.mp4` | Wedding |
| `funerals.mp4` | Funerals |
| `corporate.mp4` | Corporate |
| `private-party.mp4` | Private Party |
| `christening.mp4` | Christening |
| `other.mp4` | Other |

- **Format:** MP4 (H.264). Short loop, e.g. 3–10 seconds; videos auto-play muted and loop.
- **Aspect:** Portrait or square works best; videos are cropped with `object-fit: cover` to fill the card.
- **Size:** ~800px wide is enough for phones; keep file size modest (e.g. under 500 KB–1 MB per clip) for fast loading.

If a file is missing or fails to load, the card still shows the event label on a dark background.
