# French UI from one dictionary, English codebase

Every user-facing string is French (fr-CA) and comes from `src/locales/fr.json`; every identifier,
column name, filename and comment is English. Stored values map to French labels in exactly one
place, `src/lib/registrationOptions.js`, so a raw enum never reaches the screen. The users are a
Québécois friend group who want the app in their language; the maintainers — human and agent — work
in the lingua franca of the ecosystem.

## Consequences

- There is no i18n library and no second locale. `fr.json` is a flat key→string object imported
  directly; adding English later would mean introducing a real i18n layer, which nobody wants.
- The rule is only as good as its enforcement, and enforcement is currently manual: ~45 French strings
  are still hardcoded in JSX, two referenced keys don't exist (so they silently render as nothing),
  and 91 keys are unused. A CI check that every `fr.*` reference resolves would make the rule real.
- **UTF-8 without BOM is part of this decision, not a detail.** Accented French in source files is
  what makes encoding drift visible (`Ã‰vÃ©nement archivÃ©` appears in the project notes), and five
  tracked files currently carry a BOM.
