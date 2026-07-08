# Fibra+ Hub

## Correção atual
- Criado endpoint `/api/efi/status` para informar se a Conta Efí 1 está integrada.
- Ao salvar/testar a Conta Efí 1, agora também são gravadas flags globais de integração no painel.
- Adicionado `efi-status.js` para que telas de boletos/importação reconheçam a Efí integrada.
- Os boletos importados passam a consultar o status real da integração, em vez de depender apenas de mensagem antiga.

Depois de publicar, faça Ctrl+F5.
