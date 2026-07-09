# Relatório Efí Supabase + Boletos

## Tabelas usadas
- `efi_configuracoes`
- `efi_boletos_vinculos`

## Endpoints Efí
- `GET /api/efi/config?conta=1`
- `POST /api/efi/salvar-config`
- `POST /api/efi/testar-conexao`
- `GET /api/efi/status`
- `GET /api/efi/status-online?conta=1`
- `GET /api/efi/boletos/teste`
- `POST /api/efi/boleto-importado/consultar`

## Segurança
- Não usa arquivo local.
- Não usa localStorage para salvar credenciais.
- Salva no Supabase via backend/server.js.

## Validação técnica
- node --check: OK
- require('path'): 1
- require('fs'): 0
- rotas totais: 37
