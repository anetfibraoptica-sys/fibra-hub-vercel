# Auditoria API / MikroTik / Efí

## Diagnóstico encontrado

- O projeto não usa pasta `api`; as APIs ficam em `server.js`.
- O `vercel.json` redireciona `/api/*` para `server.js`.
- O problema de **Servidores OFF** estava em `/api/servidores`: a rota retornava apenas o cache inicial `online:false`.
- `/api/online` já consultava `/ppp/active/print` no MikroTik.
- `Clientes ON/OFF` no resumo usa `/api/cliente/status`, baseado em `/ppp/active/print` do servidor selecionado.
- Efí nesta versão fica no backend local (`data/efi-config.json`), sem Supabase.

## Correções aplicadas

- `/api/servidores` agora consulta MikroTik em tempo real com `consultarOnlineServidor` e `consultarStatusServidor`.
- `/api/cliente/status` foi movida para antes do bloco de inicialização do servidor.
- Criadas rotas de diagnóstico:
  - `/api/diagnostico/mikrotik`
  - `/api/diagnostico/rotas`
- Nenhum HTML/layout/menu foi alterado.

## Rotas existentes no backend

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
- `GET /api/diagnostico/mikrotik`
- `GET /api/diagnostico/rotas`

## Arquivos com chamadas `/api/...`

- `server.js`
  - `/api/cliente/status`
  - `/api/clientes`
  - `/api/clientes/:id`
  - `/api/clientes/:id/acesso-remoto`
  - `/api/clientes/:id/bloquear`
  - `/api/clientes/:id/confianca`
  - `/api/clientes/:id/desbloquear`
  - `/api/clientes/:id/remoto-link`
  - `/api/clientes/:id/status-mikrotik`
  - `/api/diagnostico/mikrotik`
  - `/api/diagnostico/rotas`
  - `/api/efi/boletos/teste`
  - `/api/efi/config`
  - `/api/efi/salvar-config`
  - `/api/efi/status`
  - `/api/efi/testar-conexao`
  - `/api/latest`
  - `/api/login`
  - `/api/login-teste`
  - `/api/mikrotik/cliente-acao`
  - `/api/mikrotik/cliente-profile`
  - `/api/mikrotik/profiles`
  - `/api/mikrotik/test`
  - `/api/online`
  - `/api/servidores`
  - `/api/status`
  - `/api/status-atual`
  - `/api/status-mikrotik`
  - `/api/update`
- `public/app.js`
  - `/api/online`
- `public/cadastro.html`
  - `/api/cliente/status?login=`
  - `/api/mikrotik/cliente-acao`
  - `/api/mikrotik/cliente-profile`
  - `/api/mikrotik/profiles?servidor=`
- `public/financeiro-efi.js`
  - `/api/servidores?_=`
- `public/financeiro.html`
  - `/api/efi/boletos/teste`
  - `/api/efi/config?conta=`
  - `/api/efi/salvar-config`
  - `/api/efi/testar-conexao`
- `public/index.html`
  - `/api/login`
- `public/pppoe-stable.js`
  - `/api/servidores?_=`

## Como testar depois do deploy

- Acesse `/api/diagnostico/mikrotik` para ver se Armando/Colônia respondem.
- Acesse `/api/servidores` para ver se `online:true` aparece.
- Acesse `/api/online` para ver clientes PPPoE ativos.
- Se continuar OFF, o erro mostrado será de variável MikroTik ausente ou falha de conexão RouterOS.