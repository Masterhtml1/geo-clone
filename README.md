# Pulse Vector

A rhythm platformer in one self-contained `index.html`: canvas rendering, Web Audio music and sound effects, no external assets. Open the file in a browser to play.

- **Controls:** Space / Up / W / click / tap to act · Esc pause · R restart · P hitboxes · Z / X place / remove practice checkpoints
- **Levels:** First Light (Easy), Gravity Drift (Normal), Prism Static (Hard), Hyperion Overdrive (Insane)

## Verifying the levels

```
node tools/verify.js            # feel tests + bot runs at 60/30/20 Hz input granularity
node tools/verify.js --quick    # 60 Hz only
node tools/verify.js --level=3  # one level
```

The verifier pulls the simulation core out of `index.html` (between the `@@CORE_START` / `@@CORE_END` markers), so it tests the exact physics the game runs. It checks the cube's feel targets, checks that physics is identical at 30, 60 and 144 fps, and runs a beam-search bot that has to reach the finish line of every level.
