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

## S12-01 workspaces

The extension mounts Story, World, and Director workspaces behind the same
extension boundary. Workspace reads and writes use the fixed same-origin bridge
surface; the browser never selects a Runtime URL or sends database commands
directly. World Guide output is rendered as an untrusted proposal, then confirmed
through versioned World Bible commands. A locked World Bible and an opening route
are required before the Story stage can bind a Runtime branch.

On a new personal installation Novel Mode is enabled by default and opens the
actual Studio surface from the normal SillyTavern page. The settings drawer
remains an escape hatch, not the primary product entry. Closing the Studio is
reversible and does not change Runtime state.

`workspace-state.js` is a pure state machine for the inspiration -> guide -> lock
-> opening -> stage sequence. `workspace-client.js` contains the versioned Runtime
API calls and validates opaque identifiers and schema envelopes.

## S12-02 World and Director workbenches

The World workspace loads a Runtime-filtered workbench view. Authors review
each World Bible item explicitly, then choose locked, tentative, or open
control without editing a prompt. Validation and World Snapshot conflicts keep
their source evidence beside the affected item. Chapter goals, character arcs,
foreshadowing, tasks, author truths, reader disclosures, opening routes, theme
tokens, assets, and registered component previews remain structured views.

The Director workspace reads the latest saved Context Pack diagnostic and
shows recall reason, visibility, budget decision, and source metadata. A player
account receives only public world records and non-private Writer-included
recall fragments. Author truth, private belief/memory records, branch heads,
director commands, imports, and manual acceptance are enforced by the server
bridge rather than hidden only by browser controls.

## S14-01 Character Card import

The World workspace can preview the currently selected Character Card or a
normalized CHARX card, then confirm the exact preview digest. The browser sends
only card fields through fixed bridge routes and renders a typed summary with
text nodes. Card prompt fields, Character Book entries, and opening text remain
untrusted import material; the client has no direct canon or database route.

## S15 release and live session entry

The release/session client uses only fixed same-origin bridge routes. A shared
link has the form `/?novel-share=<opaque-token>`; startup resolves it in memory,
loads the player-safe session and immutable release, and renders the release
blocks and registered components on the Novel stage. The share token is not
written to extension settings, SillyTavern chat, or `localStorage`.

Turn bindings now include a canonical Runtime entity ID for POV and an opaque
server model profile ID. These are identifiers, not SillyTavern character IDs,
provider URLs, or API keys. Runtime remains authoritative for player-session
POV and model profile resolution.
