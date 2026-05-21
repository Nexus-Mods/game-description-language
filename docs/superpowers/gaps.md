# GDL parity gaps

This file tracks features the GDL needs to grow to fully replace hand-written Vortex
game extensions. Items are surfaced by real ports (currently: `game-subnautica2`'s
`gdl-port` branch). When a gap closes, move it to the **Closed** section at the bottom.

## Open

### Lifecycle hooks

1. **Setup hook (`prepareForModding`).** Legacy extension ensures specific mod
   folders exist on disk the first time the game is managed. GDL's hook catalog
   only declares `detectGameVersion`. Needs an additional catalog entry.

2. **`did-deploy` event hook.** Legacy extension regenerates UE4SS `mods.txt`
   after every deployment so UE4SS can find installed mods. No GDL hook covers
   this.

### Discovery

3. **Xbox / WinGDK arch handling beyond simple `!storeBranch`.** Legacy
   `ue4ssInjectorPath` chooses `Binaries/Win64/` vs `Binaries/WinGDK/` based on
   `discovery.store === 'xbox'`. GDL's `!storeBranch` can express this for a
   `modType.path`, but not for an installer's arch-specific marker recognition
   (e.g., looking for `xinput1_4.dll` vs a different marker on Xbox).

### Mod types

4. **Per-game-instance `getPath` re-evaluation.** Legacy `registerModType`
   passes a function that reads current discovery state every time Vortex asks
   for the path. GDL evaluates context bindings once at registration into a
   frozen `resolvedCtx`. For mod paths that depend on state that can change
   after first-discovery (rare but possible), GDL needs a re-evaluation seam.

## Closed

### Installer features

- **`losesTo` / mutually-exclusive installer dispatch.** Closed by Plan 7
  (`2026-05-20-gdl-unless-predicate.md`). Installer rules now accept an
  optional `unless: <predicate>` field. When the predicate evaluates true at
  `testSupported` time, the rule self-disqualifies even if `when` would have
  matched. The predicate uses the same composable language as `when` —
  typically `!any` of `!hasFile` patterns pointing at signals for a narrower
  installer. The subnautica2-shaped fixture now demonstrates `pak`
  disqualifying itself when LogicMods or Scripts are present.

- **UE4SS injector installer pattern.** Closed by Plan 8
  (`2026-05-20-gdl-installer-engine-refinements.md`). Three engine
  refinements unlock the pattern: case-insensitive glob matching by default
  (matches Windows filesystem semantics); shallowest-matching file selected
  as the anchor (vs. archive-order-first); and file-anchor installers now
  scope routing to files under the install root, dropping outsiders.
  Combined with brace-expansion globs (`**/{a,b,c}`) and `!storeBranch` for
  arch-aware destinations, the legacy `ue4ssInjectorSpec` is now ~12 lines
  of YAML. The subnautica2-shaped fixture exercises it end-to-end.

- **Marker-find-then-walk-up routing.** Addressed in Plan 9
  (`2026-05-20-gdl-archive-root-multistore-marker.md`) by composition rather
  than a new engine primitive. The subnautica2-shaped fixture now uses two
  ue4ss-lua installers: one for the `Scripts/*.lua` form (anchor
  `**/Scripts/*.lua` + `take: parent.parent`) and one for the
  `enabled.txt`-only form (anchor `**/enabled.txt` + `take: parent.parent`
  + `unless: !hasFile "**/Scripts/*.lua"`). Both preserve the mod-name in
  the destination by relying on the depth math: when the anchor's structural
  depth equals the take offset, dropCount is 0 and the full archive path
  flows through. Stray top-level files outside the mod-name directory are
  still routed (the install-root scope is empty when dropCount is 0), which
  is the one edge case where this composition diverges from the legacy
  `findUE4SSModRoot` semantics. Acceptable for the typical archive shape; a
  future plan can introduce a `take: preserve-mod-root` strategy if a real
  game needs the strict legacy behavior.

- **`root` installer.** Closed by Plan 9. New `take: archive-root` strategy
  passes archive paths through unchanged — every file's destination is
  `${placeAt}/${source}`. Combined with `unless:` from Plan 7, the root
  installer in the fixture defers to logic-mod / ue4ss-lua / injector and
  catches archives shaped as `Subnautica2/...`, `Engine/...`, or
  `Binaries/...`.

### Discovery

- **Multi-store-in-one-call `queryPath`.** Closed by Plan 9. The shim's
  `discover()` now collects every declared store's `appId` into one array
  and calls `GameStoreHelper.findByAppId(ids)` once. Vortex's own discovery
  logic picks the matching store and reports it back in the `gameStoreId`
  field. Matches the legacy idiom and lets Vortex's preference rules apply.

### UI

- **Toolbar actions.** Closed by Plan 6 (`2026-05-20-gdl-toolbar-actions.md`).
  YAML now supports `toolbarActions:` with `!openFile` and `!openUrl` targets;
  each action is registered on Vortex's `mod-icons` toolbar and is visible only
  when the GDL-registered game is the active one. Custom click handlers (via a
  future `!hook`) and other action groups (mods-list, gamemode-toolbar) are
  follow-up; the current surface covers the subnautica2 port's three actions.

---

Source for the open items: subnautica2 port (`gdl-port` branch of
`Nexus-Mods/game-subnautica2`, see its `GAPS.md`).
