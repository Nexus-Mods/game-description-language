# GDL parity gaps

This file tracks features the GDL needs to grow to fully replace hand-written Vortex
game extensions. Items are surfaced by real ports (currently: `game-subnautica2`'s
`gdl-port` branch). When a gap closes, move it to the **Closed** section at the bottom.

## Open

### Installer features

1. **`losesTo` / mutually-exclusive installer dispatch.** Legacy extensions often
   declare that a low-priority installer "loses to" a higher-priority one — i.e.,
   if the archive matches the higher-priority installer's predicate, the
   low-priority installer should refuse to match. GDL has priority ordering but
   no exclusion predicate. Blocks the `pakAlt` and `contentFolder` installer
   shapes in subnautica2.

2. **Marker-find-then-walk-up routing.** Legacy UE4SS installer finds the
   shallowest `.lua`/`enabled.txt` marker, takes its parent directory, then walks
   up one level if the parent is named `Scripts/`. GDL's `take: parent` is
   depth-based and does not "look back" from a marker. The subnautica2 port uses
   `anchor: "**/Scripts/"` + `take: parent` which handles the common case but
   misses irregular archives.

3. **UE4SS injector installer pattern.** Find one of several marker DLLs, take
   the directory containing it, route to an arch-aware destination (e.g.,
   `Binaries/Win64/` vs `Binaries/WinGDK/`). None of the three pieces are
   expressible today. Omitted from the port.

4. **`root` installer.** "Take everything as-is from the archive root, but only
   if no other installer wins." Expressible once `losesTo` lands (item 1).

### Lifecycle hooks

5. **Setup hook (`prepareForModding`).** Legacy extension ensures specific mod
   folders exist on disk the first time the game is managed. GDL's hook catalog
   only declares `detectGameVersion`. Needs an additional catalog entry.

6. **`did-deploy` event hook.** Legacy extension regenerates UE4SS `mods.txt`
   after every deployment so UE4SS can find installed mods. No GDL hook covers
   this.

### UI

7. **Toolbar actions.** Legacy extensions register actions on Vortex toolbars
   (e.g., "Open UE4SS Settings INI", "Open Nexus Page") via
   `context.registerAction('mod-icons', priority, icon, opts, title, run, visible)`.
   GDL does not register UI actions.

### Discovery

8. **Multi-store-in-one-call `queryPath`.** Legacy extension calls
   `util.GameStoreHelper.findByAppId([STEAMAPP_ID, EPIC_CATALOG_ITEM_ID])` —
   passing all IDs in a single call. GDL's runtime iterates stores and calls
   `findByAppId(appId, storeId)` once per store. Semantics are similar but not
   identical (Vortex's array form has fallback rules our per-store loop doesn't
   express).

9. **Xbox / WinGDK arch handling beyond simple `!storeBranch`.** Legacy
   `ue4ssInjectorPath` chooses `Binaries/Win64/` vs `Binaries/WinGDK/` based on
   `discovery.store === 'xbox'`. GDL's `!storeBranch` can express this for a
   `modType.path`, but not for an installer's arch-specific marker recognition
   (e.g., looking for `xinput1_4.dll` vs a different marker on Xbox).

### Mod types

10. **Per-game-instance `getPath` re-evaluation.** Legacy `registerModType`
    passes a function that reads current discovery state every time Vortex asks
    for the path. GDL evaluates context bindings once at registration into a
    frozen `resolvedCtx`. For mod paths that depend on state that can change
    after first-discovery (rare but possible), GDL needs a re-evaluation seam.

## Closed

(nothing yet)

---

Source for items 1–10: subnautica2 port (`gdl-port` branch of
`Nexus-Mods/game-subnautica2`, see its `GAPS.md`).
