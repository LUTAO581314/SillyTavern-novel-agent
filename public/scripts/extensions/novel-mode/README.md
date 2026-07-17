# Novel Mode shell

This built-in extension is the reversible SillyTavern Novel Edition client
boundary. S06-06 adds only the integration shell:

- fixed same-origin Runtime health and turn-snapshot reads;
- project, branch, chapter, scene, audience, and recovery-cursor binding;
- `act`, `speak`, `narrate`, and author-only `direct` input intent semantics;
- a version-aware Render Event dispatcher with safe text fallback;
- an allowlisted ST message display-cache codec.

The shell does not submit a turn, register an active generation provider, call
a model or MiroFish, access PostgreSQL, or commit canonical state. S08 supplies
the real Agent turn lifecycle and persistent novel stage. Runtime snapshots,
not SillyTavern chat messages, are the recovery source.
