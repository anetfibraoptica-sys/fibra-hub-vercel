# Fibra+ Hub

## Correção atual
- Refeito o reconhecimento de Efí integrada nas telas de boletos/importação.
- `efi-status.js` agora verifica localStorage e `/api/efi/status`.
- Qualquer texto visual de 'Efí não integrada' é trocado para 'Efí integrada' quando houver Client ID/Secret salvos.
- Adicionado card de status Efí nas telas com boletos para facilitar a conferência.
- Ao salvar/testar a Conta Efí 1, o status global é marcado como integrado.

Depois de publicar, entre em Financeiro Efí, clique em Salvar configuração ou Testar conexão, depois volte nos boletos importados e faça Ctrl+F5.
