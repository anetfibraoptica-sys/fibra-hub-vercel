# Fibra+ Hub

## Correção atual
- Corrigido o fluxo de criação de boleto Efí.
- O sistema agora cria a cobrança em `/v1/charge` e depois registra o boleto em `/v1/charge/:id/pay`.
- Removida a tentativa principal via `one-step`, que estava retornando `Unauthorized`.
- Layout, menu, clientes, servidores e MikroTik não foram alterados.
