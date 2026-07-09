# Relatório Efí Online/Offline

## Adicionado
- `GET /api/efi/status-online?conta=1`
- Bloco Status da Efí na tela Financeiro Efí.
- Botão Atualizar status.

## Funcionamento
- Se Client ID/Secret estiverem salvos no Supabase e a Efí gerar token OAuth, mostra `Efí Online`.
- Se faltar configuração ou credenciais estiverem erradas, mostra `Efí Offline` com o motivo.

## Validação
- require('path'): 1
- rotas totais: 36
