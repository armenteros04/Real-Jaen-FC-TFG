# Model weights

The trained checkpoints are **not stored in git** (too large). They are
published on the repository's **[GitHub Releases](../../releases)** page.

## Required weights

| File | Size | Purpose | Config key |
|------|------|---------|------------|
| `best.pt` | ~39 MB | Custom-trained **YOLO11m** detector (player / goalkeeper / referee / ball) | `model.weights_path` |
| `pitch_keypoints_yolo11m_best.pt.pt` | ~41 MB | Trained **pitch-keypoint** model for automatic homography | `calibration.keypoint_model` |

Download both from the latest release and drop them into this `weights/`
folder, keeping the exact filenames above.

```bash
# from the repo root, with the GitHub CLI:
gh release download v1.0.0 --dir weights/
```

## Auto-downloaded weights

`yolo11m-pose.pt` (skeleton overlay) is a standard Ultralytics checkpoint and
is fetched automatically on first use — you do not need to download it
manually.

## Paths

Weight paths live in `config/config.yaml` (`model.weights_path`,
`calibration.keypoint_model`) and can be overridden on the command line with
`--weights`.
