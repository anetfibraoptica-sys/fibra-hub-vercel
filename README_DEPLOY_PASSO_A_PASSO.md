# Fibra Hub - Projeto unificado

Este projeto está pronto para ficar em um único repositório GitHub.

## Estrutura

- `public/` = painel visual para Vercel
- `server.js` = backend completo Node.js para hospedagem Node tradicional
- `bridge-api/` = API Bridge MikroTik separada
- `.env.example` = modelo das variáveis sem senhas reais

## Configuração MikroTik informada

- Armando Mendes: `d56a0ca82138.sn.mynetname.net:8728`
- Colônia Antônio Aleixo: `d56a0ca82138.sn.mynetname.net:8729`

## Importante

Nunca envie `.env` com senhas reais para o GitHub.
Use variáveis de ambiente na hospedagem.

## Vercel

A Vercel deve usar o projeto para hospedar o frontend da pasta `public`.

## API Bridge

A pasta `bridge-api` pode ser implantada separadamente em uma hospedagem Node.js.
As variáveis dela devem seguir o modelo de `bridge-api/.env.example`.
