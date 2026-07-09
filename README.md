# Fibra+ Hub

## Correção atual
- Corrigido erro que derrubava todas as APIs no Vercel.
- Removida declaração duplicada de `const path = require('path')` no `server.js`.
- Mantida apenas uma declaração de `path` e uma de `fs`.
- Não foi alterado layout/menu/HTML.

Depois de publicar, teste:
- `/api/online`
- `/api/efi/config`
- `/api/diagnostico/mikrotik`
