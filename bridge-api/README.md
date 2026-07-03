# MikroTik Bridge API

API Bridge para ligar o painel Fibra Hub ao MikroTik pela VPN WireGuard.

## Função

Ela recebe chamadas do painel na Vercel e acessa os MikroTiks pela VPN:

- AMAZONET: `10.200.200.1`
- ARMANDO MENDES: `10.200.200.2`

## Instalação

```bash
npm install
cp .env.example .env
npm start
```

## Teste local

```bash
curl http://localhost:3001/
```

## Rotas principais

Todas as rotas `/api` exigem header:

```text
Authorization: Bearer SEU_TOKEN
```

### Listar servidores

```http
GET /api/servers
```

### Testar conexão

```http
GET /api/mt1/ping
GET /api/mt2/ping
```

### Status do MikroTik

```http
GET /api/mt1/status
GET /api/mt2/status
```

### Clientes PPPoE online

```http
GET /api/mt1/pppoe/online
GET /api/mt2/pppoe/online
```

### Criar cliente PPPoE

```http
POST /api/mt1/pppoe/create
```

Body:

```json
{
  "name": "cliente_teste",
  "password": "123456",
  "profile": "PLANO_100M",
  "service": "pppoe",
  "comment": "Cliente criado pelo Fibra Hub"
}
```

### Bloquear cliente

```http
POST /api/mt1/pppoe/block
```

Body:

```json
{
  "id": "*1A"
}
```

### Desbloquear cliente

```http
POST /api/mt1/pppoe/unblock
```

Body:

```json
{
  "id": "*1A"
}
```

### Alterar plano

```http
POST /api/mt1/pppoe/change-profile
```

Body:

```json
{
  "id": "*1A",
  "profile": "PLANO_200M"
}
```

## Observação importante

Esta API precisa rodar em um ambiente que enxergue a VPN WireGuard dos MikroTiks.
A Vercel não acessa diretamente os IPs privados `10.200.200.1` e `10.200.200.2`.
