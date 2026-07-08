# Fibra+ Hub

## Correção atual
- Encontrada a origem real do Online falso no Resumo.
- O arquivo `public/app.js` reconstruía o card Resumo e colocava `Online` fixo com `.status-dot` verde.
- Removido o bloco `RESUMO LATERAL DIREITA RECEITANET` do `app.js`.
- Removido o CSS `.cadastro-resumo-card .status-dot` que deixava a bolinha verde fixa.
- O Resumo volta a usar o HTML original de `cadastro.html` e a consulta dedicada `/api/cliente/status`.

Depois de publicar na Vercel, faça Ctrl+F5 ou teste em aba anônima.
