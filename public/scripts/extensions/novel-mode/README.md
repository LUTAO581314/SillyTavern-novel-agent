# Novel Mode shell

This system extension is the first isolated Novel Edition client boundary. In
S02-04 it only mounts a reversible settings shell and reads the same-origin
server plugin health route.

It does not call a model, send a turn, render provisional prose, store Runtime
credentials, or write canonical state. The `GenerationProviderRegistry` exists
as an unwired core contract; Novel Mode generation takeover is ordered work in
S06.

The extension uses SillyTavern's normal `activate`, `enable`, `disable`, and
`delete` hooks. Its internal Enabled toggle controls only shell health checks in
this stage.
