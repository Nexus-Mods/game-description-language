# GDL parity gaps

This file tracks features the GDL needs to grow to fully replace hand-written Vortex
game extensions. Items are surfaced by real ports (currently: `game-subnautica2`'s
`gdl-port` branch). When a gap closes, move it to the **Closed** section at the bottom.

## Open

### Installer features

1. **Marker-find-then-walk-up routing.** Legacy UE4SS installer finds the
   shallowest `.lua`/`enabled.txt` marker, takes its parent directory, then walks
   up one level if the parent is named `Scripts/`. GDL's `take: parent` is
   depth-based and does not "look back" from a marker. The subnautica2 port uses
   `anchor: "**/Scripts/"` + `take: parent` which handles the common case but
   misses irregular archives.

2. **UE4SS injector installer pattern.** Find one of several marker DLLs, take
   the directory containing it, route to an arch-aware destination (e.g.,
   `Binaries/Win64/` vs `Binaries/WinGDK/`). None of the three pieces are
   expressible today. Omitted from the port.

3. **`root` installer.** "Take everything as-is from the archive root, but only
   if no other installer wins." Now expressible using `unless:` (closed in
   Plan 7) once added to a real port — see Plan 7's note about exposing it in
   the subnautica2 port as a follow-up.

### Lifecycle hooks

4. **Setup hook (`prepareForModding`).** Legacy extension ensures specific mod
   folders exist on disk the first time the game is managed. GDL's hook catalog
   only declares `detectGameVersion`. Needs an additional catalog entry.

5. **`did-deploy` event hook.** Legacy extension regenerates UE4SS `mods.txt`
   after every deployment so UE4SS can find installed mods. No GDL hook covers
   this.

### Discovery

6. **Multi-store-in-one-call `queryPath`.** Legacy extension calls
   `util.GameStoreHelper.findByAppId([STEAMAPP_ID, EPIC_CATALOG_ITEM_ID])` —
   passing all IDs in a single call. GDL's runtime iterates stores and calls
   `findByAppId(appId, storeId)` once per store. Semantics are similar but not
   identical (Vortex's array form has fallback rules our per-store loop doesn't
   express).

7. **Xbox / WinGDK arch handling beyond simple `!storeBranch`.** Legacy
   `ue4ssInjectorPath` chooses `Binaries/Win64/` vs `Binaries/WinGDK/` based on
   `discovery.store === 'xbox'`. GDL's `!storeBranch` can express this for a
   `modType.path`, but not for an installer's arch-specific marker recognition
   (e.g., looking for `xinput1_4.dll` vs a different marker on Xbox).

### Mod types

8. **Per-game-instance `getPath` re-evaluation.** Legacy `registerModType`
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
