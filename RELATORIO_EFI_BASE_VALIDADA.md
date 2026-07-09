# Relatório - Nova versão Efí sobre base validada

## Base usada

- Base de ontem validada, onde a API do projeto é o `server.js`.
- O `vercel.json` continua apontando `/api/*` para `server.js`.
- Não foi criada dependência com Supabase para Efí.

## O que foi adicionado

- Backend Efí limpo no `server.js`.
- Configuração local em `data/efi-config.json`.
- Tela Financeiro Efí salva/carrega configuração via backend.
- Endpoints Efí: config, salvar, testar conexão, status, teste de boletos e consulta de boleto importado.
- Script `public/efi-boleto-importado.js` incluído apenas em `importacao.html` e `cadastro.html`.
- Sem card extra de status Efí no layout.
- Sem campo Chave PIX e sem Certificado .p12.

## Rotas atuais

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
- `GET /api/cliente/status`
- `GET /api/efi/config`
- `POST /api/efi/salvar-config`
- `POST /api/efi/testar-conexao`
- `GET /api/efi/status`
- `GET /api/efi/boletos/teste`
- `POST /api/efi/boleto-importado/consultar`

## Chamadas /api no frontend

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
  - `/api/efi/boleto-importado/consultar`
  - `/api/efi/boletos/teste`
  - `/api/efi/config`
  - `/api/efi/salvar-config`
  - `/api/efi/status`
  - `/api/efi/testar-conexao`
  - `/api/latest`
  - `/api/login`
  - `/api/login-teste`
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
- `public/efi-boleto-importado.js`
  - `/api/efi/boleto-importado/consultar`

## Observação

- O servidor/online volta a usar as rotas originais da base: `/api/servidores`, `/api/online`, `/api/status-mikrotik` e `/api/cliente/status`.
- Em Vercel/serverless, arquivo local pode não persistir após redeploy. Mas esta versão não usa Supabase, conforme solicitado.