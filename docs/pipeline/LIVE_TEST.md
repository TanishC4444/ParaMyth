# Silent Bell live test correction

Historical fixture notes. Run identifiers and timings below describe an earlier
recorded exercise, not a verified run in this repository. Use the manual Story
runners workflow to repeat the check on ParaMyth.

The original coordinator run 39384520129 and its inference child 39384565662 were cancelled because that serial, cross-workflow layout did not meet the requested single-workflow parallelism.

The replacement workflow declares fresh runners directly as jobs, including parallel character proposals and parallel story-review/memory-extraction branches. It executes the pinned GH-INFERENCE worker inside those jobs. No child inference workflows or dispatch secret are needed.

Recorded single-scene graph exercise: run identifier `39386757448`.

Observed overlap in that run (UTC):

- Mara: 07:29:18–07:29:24.
- Oren: 07:29:19–07:29:28.
- Story review and memory extraction both began at approximately 07:30.

This is a labelled deterministic fixture test, demonstrating the actual Actions runner graph and file transfers, not literary quality. The live three-chapter test is a separate run with backend=live and scene_limit=9. Check Actions for current status and downloadable outputs.
