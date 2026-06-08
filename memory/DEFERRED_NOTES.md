# Deferred / Backlog instructions (explicit user requests to implement LATER)

## [DEFERRED] Reconciler auto-strictness against low-quality / platform-vertical theses
- Date noted: Jun 2026
- User decision: DO NOT implement automatically for now. The user wants MANUAL control
  (the Fusionar / merge feature, Phases A & B) instead. The automatic strictness may be
  useful in OTHER cases (sometimes finer slicing IS desirable), so keep it as an opt-in
  for the future — do NOT make it a default behavior.
- What it would be (when revisited): tighten `DRIVER_RECONCILER_SYS` (Pass 2,
  `services/thesis.py`) so a vertical / use-case / clinical area served by the SAME
  platform (same buyer, same customer relationship, same monetization) is NOT carved out
  as a separate thesis but folded into the platform core (optionally as a `split`).
  Plus a two-condition independence test (own demand AND own go-to-market/monetization).
  Example that motivated it: HIMS "gestión de lípidos y dislipidemia" was split out as a
  standalone thesis (no own value-chain stage → fell in "Otros", low score 60) when it is
  really a vertical of the holistic digital-health platform.
- IMPLEMENTED INSTEAD (manual): Fusionar button (Phase A before generating, Phase B after
  generating) giving the user control to merge minor/complementary theses.
