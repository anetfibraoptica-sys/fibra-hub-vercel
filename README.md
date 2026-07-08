# Fibra+ Hub

## Correção atual
- Corrigido endpoint `/api/mikrotik/profiles` para executar `/ppp/profile/print` usando `routerosSend` do próprio projeto.
- Adicionado script final na tela de cadastro usando os IDs reais: `cadPop`, `cadProfile`, `resServidor` e `resProximaFatura`.
- O servidor selecionado agora é escrito no Resumo após o app.js reconstruir o card.
- A próxima fatura aberta é recalculada após o resumo ser recriado, buscando boletos/faturas locais/importados.
- Mantida a estrutura visual existente.

Depois de publicar, faça Ctrl+F5 e teste com F12 em `/api/mikrotik/profiles?servidor=Col%C3%B4nia%20Ant%C3%B4nio%20Aleixo`.
