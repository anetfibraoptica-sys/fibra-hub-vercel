# Relatório da base de ontem - Fibra+ Hub

## Resultado da análise

- Essa base **não possui pasta `api`**.
- As APIs do projeto estão no arquivo **`server.js`**.
- O arquivo **`vercel.json`** redireciona `/api/*` para `server.js`.
- Portanto, nesse ZIP, a ausência da pasta `api` não significa necessariamente erro; é a arquitetura usada nessa base.

## Estrutura principal encontrada

- `server.js`
- `public/`
- `package.json`
- `vercel.json`

## Rotas backend encontradas em server.js

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

## Arquivos que chamam `/api/...`

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
- `public/index.html`
  - `/api/login`
- `public/pppoe-stable.js`
  - `/api/servidores?_=`

## Ajuste feito

- Validei a estrutura sem alterar HTMLs ou menu.
- Mantive o projeto na arquitetura original dessa base.
- Apenas corrigi a posição da rota `/api/cliente/status`, caso estivesse após o bloco de inicialização do servidor.