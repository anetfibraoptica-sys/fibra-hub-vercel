# Diagnóstico Servidores OFF

## Correções
- `servidorConfig()` aceita nomes alternativos de variáveis.
- `/api/servidores` consulta MikroTik em tempo real.
- Adicionado `/api/diagnostico/mikrotik`.
- Adicionado `/api/servidores-debug`.

## Teste após deploy
Abra `/api/diagnostico/mikrotik`. Se `hostConfigurado`, `userConfigurado` ou `passConfigurado` vier `false`, falta variável no deploy. Se vier `true` com timeout, é acesso RouterOS/API.

## Rotas
- `GET /`
- `GET /api/login-teste`
- `POST /api/login`
- `GET /api/status`
- `POST /api/update`
- `GET /api/latest`
- `GET /api/status-atual`
- `GET /api/servidores`
- `GET /api/clientes`
- `POST /api/clientes`
- `GET /api/clientes/:id/acesso-remoto`
- `GET /remoto/:id`
- `GET /api/clientes/:id/remoto-link`
- `GET /api/clientes/:id/status-mikrotik`
- `GET /api/clientes/:id`
- `PUT /api/clientes/:id`
- `POST /api/clientes/:id/bloquear`
- `POST /api/clientes/:id/desbloquear`
- `POST /api/clientes/:id/confianca`
- `DELETE /api/clientes/:id`
- `GET /api/mikrotik/test`
- `GET /api/online`
- `GET /api/status-mikrotik`
- `GET /api/mikrotik/profiles`
- `POST /api/mikrotik/cliente-profile`
- `POST /api/mikrotik/cliente-acao`
- `GET /api/efi/config`
- `POST /api/efi/salvar-config`
- `POST /api/efi/testar-conexao`
- `GET /api/efi/status`
- `GET /api/efi/boletos/teste`
- `GET /api/cliente/status`
- `GET /api/diagnostico/rotas`
- `GET /api/diagnostico/mikrotik`
- `GET /api/servidores-debug`